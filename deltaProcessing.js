import * as rst from 'rdf-string-ttl';
import * as sjp from 'sparqljson-parse';
import * as mas from '@lblod/mu-auth-sudo';
import * as env from './env';
import * as pbu from './parse-bindings-utils';
import * as N3 from 'n3';
const { namedNode } = N3.DataFactory;
import pta from './config/pathsToAdministrativeUnit';

export async function processDeltaChangesets(changesets) {
  for (const changeset of changesets) {
    await processDeletes(changeset.deletes);
    await processInserts(changeset.inserts);
  }
}

async function processInserts(inserts) {
  //Convert to store
  const store = new N3.Store();
  inserts.forEach((insert) => {
    //Filter for the inserts or deletes graph used for ingesting
    if (env.TEMP_GRAPH_INSERTS === insert.graph.value)
      store.addQuad(pbu.parseSparqlJsonBindingQuad(insert));
  });

  //Nothing in the store, nothing to do.
  //TODO potentially throw error stating that there is nothing to process?
  if (store.size < 1) return;

  //Get all subjects from the store and their type from the triplestore (could
  //be in any graph)
  const subjects = store.getSubjects();
  const subjectsWithTypes = await getTypesForSubjects(subjects);

  //Use that to find bestuurseenheid with type specific queries, loop per subject
  //  Not-found:
  //    Leave data alone, do nothing else
  //  Found:
  //    Move data per subject from temp-insert to the org graph
  //    Schedule:
  //      Get all subjects from temp-insert and their type and try those queries again
  //      Move data per subject
  //      Reschedule if something done
  for (const individual of subjectsWithTypes) {
    const { subject, type } = individual;
    const organisationUUIDs = await getOrganisationUUIDs(subject, type);
    if (organisationUUIDs.length > 1) {
      //TODO? throw error or something to indicate that there might be a problem?
    } else if (organisationUUIDs.length === 1) {
      const organisationGraph = namedNode(
        `${env.ORGANISATION_GRAPH_PREFIX}${organisationUUIDs[0]}`
      );
      const insertGraph = namedNode(env.TEMP_GRAPH_INSERTS);
      //Execute move query for all data of that `subject` to graph constructed from the UUID
      await moveSubjectBetweenGraphs(subject, insertGraph, organisationGraph);
      //TODO Schedule
    }
    //else: do nothing (TODO potential error message, to indicate nothing could
    //be done, but this is actually a rather normal occurence)
  }
}

//Delete triples from temp-insert. (This is a bit of a guess, we assume
//triples are unique accross the whole database. We have to do this because
//we can't link every deleted triple on its own to an organisation.)
//Remove delete triples from the temp-delete, that graph should be empty if
//there are not problematic triples.
async function processDeletes(deletes) {
  //Convert to store
  const store = new N3.Store();
  deletes.forEach((triple) => {
    //Filter for the inserts or deletes graph used for ingesting
    if (env.TEMP_GRAPH_DELETES === triple.graph.value)
      store.addQuad(pbu.parseSparqlJsonBindingQuad(triple));
  });

  //Nothing in the store, nothing to do.
  //TODO potentially throw error stating that there is nothing to process?
  if (store.size < 1) return;

  //Query for every triple all the graphs it exists in
  const storeWithAllGraphs = await getGraphsForTriples(store);
  const problematicTriples = [];
  for (const triple of store) {
    const graphs = storeWithAllGraphs
      .getGraphs(triple.subject, triple.predicate, triple.object)
      .filter((g) => g.value !== env.TEMP_GRAPH_DELETES)
      .filter((g) => g.value !== env.TEMP_GRAPH_INSERTS)
      .filter((g) => g.value.includes(env.ORGANISATION_GRAPH_PREFIX));
    if (graphs.length > 1) {
      //Triple found in more than 1 organisation graph. Mark this triple as
      //problematic so that it won't be removed
      problematicTriples.push(triple);
    }
    //else: This is good: the triple only exists in one graph and because of
    //the similar URI, it must be the correct organisation graph. This triple
    //can be removed from all the graphs previously found.
  }
  problematicTriples.forEach((t) => {
    storeWithAllGraphs.removeQuad(t.subject, t.predicate, t.object);
  });

  await deleteData(storeWithAllGraphs);
}

///////////////////////////////////////////////////////////////////////////////
// Helpers
///////////////////////////////////////////////////////////////////////////////

async function getTypesForSubjects(subjects) {
  const response = await mas.querySudo(`
    ${env.SPARQL_PREFIXES}
    SELECT DISTINCT ?subject ?type WHERE {
      ?subject rdf:type ?type .
      VALUES ?subject {
        ${subjects.map(rst.termToString).join(' ')}
      }
    }`);
  const parser = new sjp.SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  return parsedResults;
}

//Get data from the triplestore
async function getInsertSubjectsWithType() {
  //Execute query asking for all unique subjects in the temp-insert graph and their type (from anywhere in the triplestore)
  //Return store with only triples { <something> rdf:type <type> }
  //TODO
}

async function getGraphsForTriples(store) {
  const values = [];
  store.forEach((triple) => {
    values.push(
      `(${rst.termToString(triple.subject)} ${rst.termToString(
        triple.predicate
      )} ${rst.termToString(triple.object)})`
    );
  });
  const response = await mas.querySudo(`
    SELECT ?s ?p ?o ?g WHERE {
      VALUES (?s ?p ?o) {
        ${values.join('\n')}
      }
      GRAPH ?g {
        ?s ?p ?o .
      }
    }`);
  const parser = new sjp.SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  const resultStore = new N3.Store();
  parsedResults.forEach((res) => {
    resultStore.addQuad(res.s, res.p, res.o, res.g);
  });
  return resultStore;
}

async function getOrganisationUUIDs(subject, type) {
  //Find correct query from a config with `type`
  let organisationUUIDs = new Set();
  for (const pathConfig of pta) {
    if (pathConfig.type.value === type.value) {
      const response = await mas.querySudo(`
        ${env.SPARQL_PREFIXES}
        SELECT DISTINCT ?organisationUUID WHERE {
          BIND (${rst.termToString(subject)} AS ?subject) .
          ${pathConfig.pathToWorshipAdminUnit}
          ?worshipAdministrativeUnit mu:uuid ?organisationUUID .
        }`);
      const parser = new sjp.SparqlJsonParser();
      const parsedResults = parser
        .parseJsonResults(response)
        .map((o) => o.organisationUUID.value);
      parsedResults.forEach((i) => organisationUUIDs.add(i));
    }
  }
  return [...organisationUUIDs];
}

//This method should work, but due to a bug in Virtuoso, the queries produced
//by mu-auth don't work properly, leaving data in the originalGraph. This is
//solved by first retreiving all the data and executing individual queries per
//triple if the object is a typed literal. :O (I know this is bad)
//
//async function moveSubjectBetweenGraphs(subject, originalGraph, targetGraph) {
//  await mas.updateSudo(`
//    ${env.SPARQL_PREFIXES}
//    DELETE {
//      GRAPH ${rst.termToString(originalGraph)} {
//        ?s ?p ?o .
//      }
//    }
//    INSERT {
//      GRAPH ${rst.termToString(targetGraph)} {
//        ?s ?p ?o .
//      }
//    }
//    WHERE {
//      GRAPH ${rst.termToString(originalGraph)} {
//        ?s ?p ?o .
//        VALUES ?s {
//          ${rst.termToString(subject)}
//        }
//      }
//    }`);
//}

async function moveSubjectBetweenGraphs(subject, originalGraph, targetGraph) {
  //Get all data for this subject
  const data = await getDataForSubject(subject, originalGraph);
  //Insert it in the target graph (all at once)
  await insertData(data, targetGraph);
  //Remove triples without literals or untyped literals
  const literalTriples = [];
  data.forEach((quad) => {
    if (quad.object.termType === 'Literal') literalTriples.push(quad);
  });
  data.removeQuads(literalTriples);
  await deleteData(data, originalGraph);

  //Remove triples with typed literals, one by one, due to a bug in Virtuoso
  for (const triple of literalTriples) {
    const deleteStore = new N3.Store();
    deleteStore.addQuad(triple);
    await deleteData(deleteStore, originalGraph);
  }
}

//Generic
//graph optional
async function getDataForSubject(subject, graph) {
  const allDataResponse = graph
    ? await mas.querySudo(`
      SELECT ?p ?o WHERE {
        GRAPH ${rst.termToString(graph)} {
          ${rst.termToString(subject)} ?p ?o .
        }
      }`)
    : await mas.querySudo(`
      SELECT ?p ?o WHERE {
        GRAPH ?g {
          ${rst.termToString(subject)} ?p ?o .
        }
      }`);
  const parser = new sjp.SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(allDataResponse);
  const store = new N3.Store();
  parsedResults.forEach((triple) =>
    store.addQuad(subject, triple.p, triple.o, graph || triple.g)
  );
  return store;
}

//**Please don't use this unless absolutely necessary.**
//This should produce the same results as a TTL writer, but literals with
//datatype xsd:string in the term in the store, also explicitly have the
//^^xsd:string in the TTL. Regular writer see this as redundant information and
//don't print the ^^xsd:string, however, due to the weird behaviour of
//Virtuoso, we need the type if we want to remove a typed literal from the
//triplestore, including for strings. This is also because the delta-consumer
//**always** adds the type to a literal, even for strings where that would be
//redundant.
function formatTriple(quad) {
  return `${rst.termToString(quad.subject)} ${rst.termToString(
    quad.predicate
  )} ${formatTerm(quad.object)} .`;
}

function formatTerm(term) {
  if (term.datatype?.value === 'http://www.w3.org/2001/XMLSchema#string')
    return `${rst.termToString(term)}^^${rst.termToString(term.datatype)}`;
  else return rst.termToString(term);
}

//Generic
//insert in graph from the triple in the store
//graph optional: ignores the embedded graph and inserts in this one
async function insertData(store, graph) {
  const insertFunction = async (store, graph) => {
    const writer = new N3.Writer();
    store.forEach((q) => writer.addQuad(q.subject, q.predicate, q.object));
    const triplesSparql = await new Promise((resolve, reject) =>
      writer.end((error, result) => {
        if (error) reject(error);
        else resolve(result);
      })
    );
    await mas.updateSudo(`
      INSERT DATA {
        GRAPH ${rst.termToString(graph)} {
          ${triplesSparql}
        }
      }`);
  };

  if (store.size < 1) return;
  if (graph) await insertFunction(store, graph);
  else
    for (const graph of store.getGraphs()) {
      const triples = store.getQuads(undefined, undefined, undefined, graph);
      await insertFunction(triples, graph);
    }
}

//Generic
//delete in graph from the triple in the store
//graph optional: ignores the embedded graph and inserts in this one
async function deleteData(store, graph) {
  const deleteFunction = async (store, graph) => {
    //const writer = new N3.Writer();
    //store.forEach((q) => writer.addQuad(q.subject, q.predicate, q.object));
    //const triplesSparql = await new Promise((resolve, reject) =>
    //  writer.end((error, result) => {
    //    if (error) reject(error);
    //    else resolve(result);
    //  })
    //);

    //Slightly less reliable and more verbose, but keeping the datatype is
    //necessary for Virtuoso to be able to delete the data. Another bug?
    const triplesSparql = [];
    store.forEach((quad) => {
      triplesSparql.push(formatTriple(quad));
    });

    await mas.updateSudo(`
      DELETE DATA {
        GRAPH ${rst.termToString(graph)} {
          ${triplesSparql.join('\n')}
        }
      }`);
  };

  if (store.size < 1) return;
  if (graph) await deleteFunction(store, graph);
  else
    for (const graph of store.getGraphs()) {
      const triples = store.getQuads(undefined, undefined, undefined, graph);
      await deleteFunction(triples, graph);
    }
}

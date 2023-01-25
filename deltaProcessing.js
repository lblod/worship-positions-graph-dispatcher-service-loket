import * as rst from 'rdf-string-ttl';
import * as sjp from 'sparqljson-parse';
import * as mas from '@lblod/mu-auth-sudo';
import * as env from './env';
import * as pbu from './parse-bindings-utils';
import * as N3 from 'n3';
const { namedNode } = N3.DataFactory;
import pta from './config/pathsToAdministrativeUnit';

/**
 * Main entry function for processing deltas. Stores inserts in the correct
 * organisation graph (configurable via query paths) and performs deletes in
 * the temporary data and the organisation graph. It processes deletions of
 * data before insertions of data per changeset in the order they appear.
 *
 * @public
 * @async
 * @function
 * @param {Iterable} changesets - This is an iterable collection of changesets
 * from the delta-notifier, usually an Array with objects like `{ inserts:
 * [...], deletes: [...] }`
 * @returns {Object} An object with prorerties `inserts` and `deletes` that
 * contain the results from `processInserts` and `processDeletes` respectively.
 * @throws Will rethrow an exception if any error has occured (network, SPARQL,
 * timeout, ...)
 */
export async function processDeltaChangesets(changesets) {
  let deletesResults = [];
  let insertsResults = [];
  for (const changeset of changesets) {
    const deleteRes = await processDeletes(changeset.deletes);
    const insertRes = await processInserts(changeset.inserts);
    deletesResults = deletesResults.concat(deleteRes);
    insertsResults = insertsResults.concat(insertRes);
  }
  return {
    inserts: insertsResults,
    deletes: deletesResults,
  };
}

/**
 * Takes a collection of inserts and processes them. They are inserted in the
 * graph for the correct organisation and removed from the temporary insert
 * graph. The organisation graph is found by querying configurable paths (see
 * the `config/pathsToAdministrativeUnit.js` file).
 *
 * @see dispatch
 * @async
 * @function
 * @param {Iterable} inserts - An iterable with triples formatted in JSON
 * syntax, e.g. `{ subject: {...}, predicate: {...}, object: {...}, graph:
 * {...} }`. These are usually the contents of changesets from the
 * delta-notifier.
 * @returns {Object | Array(Object)} Either an object with properties `success`
 * (Boolean) and `reason` (String) or the  array of results from `dispatch`.
 * @throws Will throw an exception on any kind of error.
 */
async function processInserts(inserts) {
  //Convert to store
  const store = new N3.Store();
  inserts.forEach((insert) => {
    //Filter for the inserts or deletes graph used for ingesting
    if (env.TEMP_GRAPH_INSERTS === insert.graph.value)
      store.addQuad(pbu.parseSparqlJsonBindingQuad(insert));
  });

  //Nothing in the store, nothing to do.
  if (store.size < 1)
    return {
      success: false,
      type: 'Insert',
      reason: 'Nothing in the inserts to process.',
    };

  //Get all subjects from the store and their type from the triplestore (could
  //be in any graph)
  const subjects = store.getSubjects();
  const subjectsWithTypes = await getTypesForSubjects(subjects);

  return dispatch(subjectsWithTypes);
}

/**
 * Holds a timer for scanning and processing the inserts. This is executed
 * every time a processing has succesfully dispatched at least one subject to
 * try and see if another subject can be moved.
 * @see scanAndProcessInserts
 *
 * @global
 */
let scanAndProcessTimer;

/**
 * @see processInserts
 * This is the second half of that function. It starts from a store containing
 * at least one subject and its type to find the organisation graph and move
 * the data.
 *
 * @async
 * @function
 * @param {Array(Object(subject: NamedNode, type: NamedNode))}
 * subjectsWithTypes - An array of JavaScript objects with the subject and type
 * as RDF.JS NamedNode terms.
 * @returns {Array(Object)} An array of objects per processed subjects. Every
 * object contains properties `success` (Boolean), `subject` (NamedNode) and
 * `reason` (String), but might also contain some more helpful debugging data.
 * @throws Will throw an exception on any kind of error.
 */
async function dispatch(subjectsWithTypes) {
  const results = [];
  let needsToSchedule = false;
  for (const individual of subjectsWithTypes) {
    const { subject, type } = individual;
    const organisationUUIDs = await getOrganisationUUIDs(subject, type);
    if (organisationUUIDs.length > 1) {
      //Append a result object to indicate a failure to move the data
      results.push({
        success: false,
        mode: 'Insert',
        subject,
        type,
        reason: 'Too many possible organisations',
        organisationUUIDs,
      });
    } else if (organisationUUIDs.length === 1) {
      const organisationGraph = namedNode(
        `${env.ORGANISATION_GRAPH_PREFIX}${organisationUUIDs[0]}`
      );
      const insertGraph = namedNode(env.TEMP_GRAPH_INSERTS);
      //Execute move query for all data of that `subject` to graph constructed
      //from the UUID
      await moveSubjectBetweenGraphs(subject, insertGraph, organisationGraph);
      //Schedule a new iteration of insert processing
      needsToSchedule = true;
      //Append a result object to indicate success
      results.push({
        success: true,
        mode: 'Insert',
        subject,
        type,
        reason: 'Data successfully moved for this subject.',
        organisationGraph,
      });
    } else {
      //Append result object to indicate nothing could be done, but this is
      //actually a rather normal occurence
      results.push({
        success: false,
        mode: 'Insert',
        subject,
        type,
        reason:
          'No organisation found. This could be normal. This subject is tried again later.',
      });
    }
  }
  if (needsToSchedule) {
    if (scanAndProcessTimer) {
      clearTimeout(scanAndProcessTimer);
      scanAndProcessTimer = undefined;
    }
    scanAndProcessTimer = setTimeout(scanAndProcessInserts, 5000);
  }
  return results;
}

/**
 * Takes a collection of deletes and processes them. If a triple appears in
 * **one** graph that looks like an organisation graph, it is deleted from
 * there. They are also deleted from the temporary inserts and deletes graph.
 * If the triple appears in more than one organisation graph, it has to be left
 * alone and nothing is deleted.
 *
 * Deletes triples from temporary inserts. (This is a bit of a guess, we assume
 * triples are unique accross the whole database. We have to do this because we
 * can't link every deleted triple on its own to an organisation.) Also removes
 * delete triples from the temporary deletes, that graph should be empty if
 * there are no problematic triples.
 *
 * @see deleteTriples
 * @async
 * @function
 * @param {Iterable} inserts - An iterable with triples formatted in JSON
 * syntax, e.g. `{ subject: {...}, predicate: {...}, object: {...}, graph:
 * {...} }`. These are usually the contents of changesets from the
 * delta-notifier.
 * @returns {Object | Array(Object)} Either an object with properties `success`
 * (Boolean) and `reason` (String) or the  array of results from
 * `deleteTriples`.
 * @throws Will throw an exception on any kind of error.
 */
async function processDeletes(deletes) {
  //Convert to store
  const store = new N3.Store();
  deletes.forEach((triple) => {
    //Filter for the inserts or deletes graph used for ingesting
    if (env.TEMP_GRAPH_DELETES === triple.graph.value)
      store.addQuad(pbu.parseSparqlJsonBindingQuad(triple));
  });

  //Nothing in the store, nothing to do.
  if (store.size < 1)
    return {
      success: false,
      mode: 'Delete',
      reason: 'Nothing in the deletes to process.',
    };

  return deleteTriples(store);
}

/*
 * @see processDeletes
 * Second half of that funtion. It starts with a store containing all the
 * triples that need to be deleted.
 *
 * @async
 * @function
 * @param {N3.Store} store - Store containing the triples to be deleted. This
 * could be the contents of the temporary deletes graph.
 * @returns {Array(Object)} An array of objects, only for failed deletes.
 * Failures will be rare, but successes will be plenty so we don't want all
 * those logs. These objects have properties `success` (Boolean), `reason`
  * (String), `triple` (Quad), and `graph` (NamedNode).
 * @throws Will throw an exception on any kind of error.
 */
async function deleteTriples(store) {
  const results = [];
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
      results.push({
        success: false,
        mode: 'Delete',
        reason: 'More than one organisation graph found. Not removing triple.',
        triple,
        graphs,
      });
    }
    //else: This is good: the triple only exists in one graph and because of
    //the similar URI, it must be the correct organisation graph. This triple
    //can be removed from all the graphs previously found.
  }
  problematicTriples.forEach((t) => {
    storeWithAllGraphs.removeQuad(t.subject, t.predicate, t.object);
  });
  await deleteData(storeWithAllGraphs);
  return results;
}

/**
 * Instead of starting from incoming changesets, this function can be called on
 * its own to attempt to scan the temporary inserts and deletes graphs for
 * subjects that can be moved to their organisation graph. Do this, e.g., on
 * rebooting the service.
 *
 * @public
 * @async
 * @function
 * @returns {Object} An object with properties `inserts` and `deletes` with the
 * contents of the results from `dispatch` and `deleteTriples` respectively.
 */
export async function scanAndProcess() {
  //Deletes
  const deletes = await getData(namedNode(env.TEMP_GRAPH_DELETES));
  const deletesResults = await deleteTriples(deletes);

  //Inserts
  const subjectsWithTypes = await getInsertSubjectsWithType();
  const insertsResults = await dispatch(subjectsWithTypes);

  return {
    inserts: insertsResults,
    deletes: deletesResults,
  };
}

/**
 * @see scanAndProcess
 * Same as the referenced function but only for inserts. Use this for
 * scheduling after a succesful `processInserts` to see if some more data can
 * be moved to their organisation graph now.
 *
 * Not all data can be moved to the organisation graph at once because the path
 * to the organisation might not be complete, so it sticks around in the
 * temporary graph. Every time a new delta has been processed succesfully, we
 * should check if any of sticking data now has a completed link to the
 * organisation and can be moved.
 *
 * @public
 * @async
 * @function
 * @returns {Object | Array(Object)} Returns the result of `dispatch`.
 */
export async function scanAndProcessInserts() {
  const subjectsWithTypes = await getInsertSubjectsWithType();
  return dispatch(subjectsWithTypes);
}

///////////////////////////////////////////////////////////////////////////////
// Helpers
///////////////////////////////////////////////////////////////////////////////

/**
 * Queries the triplestore to fetch the type of every given subject.
 *
 * @async
 * @function
 * @param {Iterable} subjects - A collection of subject.
 * @returns {Array(Object(subject: NamedNode, type: NamedNode))} An array of
 * JavaScript objects with the subject and type as RDF.JS NamedNode terms.
 */
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

/**
 * Execute query fetching all unique subjects in the temporary insert graph and
 * their type (from anywhere in the triplestore).
 *
 * @see getTypesForSubjects
 * @async
 * @function
 * @returns {Array(Object(subject: NamedNode, type: NamedNode))} An array of
 * JavaScript objects with the subject and type as RDF.JS NamedNode terms.
 */
async function getInsertSubjectsWithType() {
  const response = await mas.querySudo(`
    ${env.SPARQL_PREFIXES}
    SELECT DISTINCT ?subject ?type WHERE {
      GRAPH ${rst.termToString(namedNode(env.TEMP_GRAPH_INSERTS))} {
        ?subject ?p ?o .
      }
      ?subject rdf:type ?type .
    }`);

  const parser = new sjp.SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  return parsedResults;
}

/**
 * Get, for each triple in the given store, all the graphs this triple can be
 * found in. E.g. a triple to be deleted can be found in the temporary deletes
 * graph and in a certain organisation graph. Find all of the occurences of
 * this triple and return it as a single data store.
 *
 * @async
 * @function
 * @param {N3.Store} store - Store containing the triples that need to be
 * searched for. The graphs are ignored.
 * @returns {N3.Store} Store with the same triple repeated with a different
 * graph for every graph it can be found in.
 */
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

/**
 * For a given subject of a given type, finds the query that should form a path
 * to the administrative unit that should be the container of that data. Query
 * the triplestore to get the UUID of that administrative unit and return all
 * results if they can be found. Multiple paths could be found, and thus,
 * technically, multiple unique UUIDs could be returned.
 *
 * @async
 * @function
 * @param {NamedNode} subject - A given subject that needs to be resolved to an
 * administrative unit.
 * @param {NamedNode} type - The type matching the subject, used for searching
 * for the correct path to the administrative unit.
 * @returns {Array(Literal)} An array with literals containing the unique UUIDs
 * of the administrative units.
 */
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

/**
 * Moves all triples for a given subject from the given original graph to the
 * target graph. Done via a simple `DELETE ... INSERT ...` query.
 *
 * NOTE: This method should work, but due to a bug in Virtuoso, the queries
 * produced by mu-auth don't work properly, leaving data in the originalGraph.
 * This is solved by first retreiving all the data and executing individual
 * queries per triple if the object is a typed literal. :O (I know this is bad)
 * This function is disabled for now and the coming functions are the
 * workaround.
 *
 * @async
 * @function
 * @param {NamedNode} subject - The subject all data needs to be moved from.
 * @param {NamedNode} originalGraph - Graph where data will be searched in and
 * removed.
 * @param {NamedNode} targetGraph - Graph where the data will end up in.
 * @return {undefined} Nothing
 */
/*
async function moveSubjectBetweenGraphs(subject, originalGraph, targetGraph) {
  await mas.updateSudo(`
    ${env.SPARQL_PREFIXES}
    DELETE {
      GRAPH ${rst.termToString(originalGraph)} {
        ?s ?p ?o .
      }
    }
    INSERT {
      GRAPH ${rst.termToString(targetGraph)} {
        ?s ?p ?o .
      }
    }
    WHERE {
      GRAPH ${rst.termToString(originalGraph)} {
        ?s ?p ?o .
        VALUES ?s {
          ${rst.termToString(subject)}
        }
      }
    }`);
}
*/

/**
 * Moves all triples for a given subject from the given original graph to the
 * target graph. Done via a workaround that involves first getting all the data
 * for the subject, formatting the data with explicit datatypes (as another
 * workaround for weirdly explicit delta data and Virtuoso's specific datatype
 * handling), and removing data triple by triple in separate queries.
 *
 * @async
 * @function
 * @param {NamedNode} subject - The subject all data needs to be moved from.
 * @param {NamedNode} originalGraph - Graph where data will be searched in and
 * removed.
 * @param {NamedNode} targetGraph - Graph where the data will end up in.
 * @return {undefined} Nothing
 */
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

/**
 * Query the triplestore to fetch all the data for a given subject.
 *
 * @async
 * @function
 * @param {NamedNode} subject - Use this as the subject to fetch all data in
 * the triplestore.
 * @param {NamedNode} [graph] - Optional. If given, the query is limited to
 * only search through this graph. If not given the query is still executed
 * with a GRAPH clause so that the returned result store has the correct graph
 * values.
 * @returns {N3.Store} A store containing all the data.
 */
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

/**
 * Formats a quad in a Turtle/Notation3-like syntax for use in QPARQL queries.
 * The graph in the quad is ignored.
 *
 * **Please don't use this unless absolutely necessary.**
 * This should produce the same results as a TTL writer, but literals with
 * datatype `xsd:string` in the term in the store, also explicitly have the
 * `^^xsd:string` in the TTL. Regular writers see this as redundant information
 * and don't print the `^^xsd:string`, however, due to the weird(?) behaviour
 * of Virtuoso, we need the type if we want to remove a typed literal from the
 * triplestore, including for strings. This is also because the delta-consumer
 * **always** adds the type to a literal, even for strings where that would be
 * redundant.
 *
 * @function
 * @param {Quad} quad - Quad to be formatted into a Turtle/Notation3 compatible
 * string.
 * @returns {String} String representation of the quad.
 */
function formatTriple(quad) {
  return `${rst.termToString(quad.subject)} ${rst.termToString(
    quad.predicate
  )} ${formatTerm(quad.object)} .`;
}

/**
 * Formats an RDF term into a Turtle/Notation3 compatible string.
 *
 * **NOTE:** special about this function is that it explicitely adds the
 * `^^xsd:string` datatype annotation if it is present in the term to be
 * compatible with Virtuoso in DELETE queries. Prefer regular RDF writer for
 * more comprehensive writing of triples and terms.
 *
 * @function
 * @param {NamedNode} term -
 * @returns {String}
 */
function formatTerm(term) {
  if (
    term.datatype?.value === 'http://www.w3.org/2001/XMLSchema#string' ||
    term.datatype?.value ===
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
  )
    return `${rst.termToString(term)}^^${rst.termToString(term.datatype)}`;
  else return rst.termToString(term);
}

/**
 * Fetches the triples in the given graph from the triplestore.
 *
 * @async
 * @function
 * @param {NamedNode} graph - The graph from which to get the triples from.
 * @returns {N3.Store} Store containing the triples in the graph.
 */
async function getData(graph) {
  if (!graph)
    throw new Error(
      'Querying without graph is probably a mistake as it will cause an explosion of data and is therefore not allowed.'
    );
  const response = await mas.querySudo(`
    SELECT ?s ?p ?o WHERE {
      GRAPH ${rst.termToString(graph)} {
        ?s ?p ?o .
      }
    }
  `);
  const parser = new sjp.SparqlJsonParser();
  const parsedResults = parser.parseJsonResults(response);
  const store = new N3.Store();
  parsedResults.forEach((triple) =>
    store.addQuad(triple.s, triple.p, triple.o, graph)
  );
  return store;
}

/**
 * Inserts the data from a store into the graphs defined in the data or in the
 * given graph.
 *
 * @async
 * @function
 * @param {N3.Store} store - Store of data to be inserted in the triplestore.
 * @param {NamedNode} [graph] - Optional. If given ignore the graph information
 * in the quads and insert the triple in this graph. Otherwise, use the
 * internal graph information to put the triples in.
 * @returns {undefined} Nothing
 */
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

/**
 * Deletes given data from the triplestore. Deletes from the given graph only
 * or deletes from the graph embedded in the quad. Due to a bug in Virtuoso,
 * this function deletes typed literals one by one in separate queries as a
 * workaround.
 *
 * @async
 * @function
 * @param {N3.Store} store - Store with data that needs to be deleted.
 * @param {NamedNode} [graph] - Optional. If given, only remove data from that
 * graph, other wise use graph embedded in the quad.
 * @returns {undefined} Nothing
 */
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

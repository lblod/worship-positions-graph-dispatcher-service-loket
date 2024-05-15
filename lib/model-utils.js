import * as rst from 'rdf-string-ttl';
import * as N3 from 'n3';
import * as sts from './storeToTriplestore';
import model from '../config/hierarchicalModel';

let GENSYM_COUNTER = 0;

/**
 * Get data for the subject and all child entities according to the
 * hierarchical model. This data should all come from previous harvesting by
 * the same vendor.
 *
 * @public
 * @async
 * @function
 * @param {NamedNode} subject - Subject for which data should be collected, as
 * well as for its child entities.
 * @param {NamedNode} type - Type of the subject.
 * @param {NamedNode} vendor - Vendor that published the data.
 * @returns {N3.Store} Store containing all the triples that could be found.
 */
export async function getSubModelData(subject, type, vendor) {
  const store = new N3.Store();
  const queries = createQueriesForSubmodel(subject, type, vendor);
  for (const query of queries) {
    const partialStore = await sts.getDataFromConstructQuery(query);
    partialStore.forEach((t) => {
      store.addQuad(t);
    });
  }
  return store;
}

/**
 * Creates a list of CONSTRUCT queries to retrieve the data for the given
 * subject and all child entities. Every query in the list is for one of the
 * child entities.
 *
 * @public
 * @async
 * @function
 * @param {NamedNode} subject - Subject for which data should be collected, as
 * well as for its child entities.
 * @param {NamedNode} type - Type of the subject.
 * @param {NamedNode} vendor - Vendor that published the data.
 * @returns {Array(String)} Array of queries.
 */
export function createQueriesForSubmodel(subject, type, vendor) {
  const queries = [];
  const submodel = findSubModelForType(type);
  const submodels = getSubModelsFlat(submodel);
  for (const sm of submodels) {
    const path = pathBetweenModels(submodel, sm);
    const query = createQueryForPath(path, subject, vendor);
    queries.push(query);
  }
  return queries;
}

/**
 * Creates a CONSTRUCT query to retrieve the data for the last model element of
 * the path. The path should start with the model element corresponding to the
 * type of the given subject. The query is limited to subjects that have been
 * harvested for the given vendor.
 * E.g. if the path contains the model elements for the EredienstMandataris and
 * Person, then the subject should be of the type EredienstMandataris, and the
 * resulting CONSTRUCT query will retrieve all data for the person that is
 * connected by that path to the given subject.
 *
 * @public
 * @async
 * @function
 * @param {Array(Object)} path - List of hierarchical model elements that
 * serves as a path between two elements.
 * @param {NamedNode} subject - Subject to start the path with.
 * @param {NamedNode} vendor - Vendor that published the data.
 * @returns {Array(String)} The resulting CONSTRUCT query.
 */
export function createQueryForPath(path, subject, vendor) {
  const subjectChain = path.map(() => {
    return gensym('?v');
  });
  const constructPart = [];
  const wherePart = [];

  wherePart.push(`BIND (${rst.termToString(subject)} as ${subjectChain[0]})`);
  for (let i = 1; i < path.length; i++) {
    wherePart.push(
      `${subjectChain[i - 1]} ${rst.termToString(path[i].path)} ${subjectChain[i]} .`,
    );
  }
  for (let i = 0; i < path.length; i++) {
    wherePart.push(
      `${subjectChain[i]} rdf:type ${rst.termToString(path[i].type)} .`,
      //`${subjectChain[i]} <http://www.w3.org/ns/prov#wasGeneratedBy> <http://lblod.data.gift/id/app/lblod-harvesting> .`,
      `${subjectChain[i]} <http://www.w3.org/ns/prov#wasAssociatedWith> ${rst.termToString(vendor)} .`,
    );
  }
  const lastP = gensym('?v');
  const lastO = gensym('?v');
  const lastTriple = `${subjectChain[subjectChain.length - 1]} ${lastP} ${lastO} .`;
  wherePart.push(lastTriple);
  constructPart.push(lastTriple);

  const query = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

    CONSTRUCT {
      ${constructPart.join('\n')}
    }
    WHERE {
      ${wherePart.join('\n')}
    }
  `;
  return query;
}

/**
 * Find the model element in the hierarchical tree that corresponds with the
 * given type.
 *
 * @public
 * @async
 * @function
 * @param {NamedNode} type - Type of the element.
 * @returns {Object|undefined} The model element that corresponds with the
 * type. Undefined if not found.
 */
export function findSubModelForType(type) {
  const searchFunction = function search(element) {
    if (element.type.value === type.value) return element;
    else if (element.children)
      for (const child of element.children) {
        const res = search(child);
        if (res) return res;
      }
    else return undefined;
  };
  for (const m of model) {
    const res = searchFunction(m);
    if (res) return res;
  }
}

/**
 * Get a flat list of all model elements that are children (recursively) of the
 * given model element. The elements in the result still have their children
 * defined.
 *
 * @public
 * @async
 * @function
 * @param {Object} submodel - Model element to start from.
 * @returns {Array(Object)} Array with the elements that are children (direct
 * or indirect) of the given element.
 */
export function getSubModelsFlat(submodel) {
  const res = [];
  const appendFunction = function append(element) {
    const children = element?.children || [];
    children.forEach((e) => res.push(e));
    children.forEach((e) => append(e));
  };
  if (submodel === model) {
    for (const m of submodel) {
      res.push(m);
      appendFunction(m);
    }
  } else {
    if (submodel) res.push(submodel);
    appendFunction(submodel);
  }
  return res;
}

/**
 * Generates a 'symbol'. This can be used to generate e.g. a variable name.
 *
 * @public
 * @async
 * @function
 * @param {String} [prefix = 'G_'] - Prefix to use. Every generated symbol will
 * have this as its prefix, followed by a number that is unique between 0 and
 * GENSYM_COUNTER.
 * @returns {String} Symbol
 */
export function gensym(prefix = 'G_') {
  GENSYM_COUNTER++;
  if (GENSYM_COUNTER > 100000) gensymReset();
  return `${prefix}${GENSYM_COUNTER}`;
}

/**
 * Resets the counter used to generate semi-unique symbols.
 *
 * @public
 * @async
 * @function
 * @returns {undefined} Nothing
 */
export function gensymReset() {
  GENSYM_COUNTER = 0;
}

/**
 * Find the parent model element in the hierarchical tree.
 *
 * @public
 * @async
 * @function
 * @param {Object} submodel - Current element you want the parent of.
 * @returns {Object|undefined} The parent element, undefined if not found.
 */
export function modelParent(element) {
  const searchFunction = function search(current) {
    const currentChildren = current?.children || [];
    if (currentChildren.includes(element)) return current;
    else
      for (const child of currentChildren) {
        const res = search(child);
        if (res) return res;
      }
  };
  if (element === model) return undefined;
  if (model.includes(element)) return undefined;

  for (const m of model) {
    const res = searchFunction(m);
    if (res) return res;
  }
}

/**
 * Find the path between two model elements in the hierarchical tree. The top
 * and bottom model elements are included in the path.
 *
 * @public
 * @async
 * @function
 * @param {Object} top - Top most element of the two.
 * @param {Object} bottom - Bottom most element of the two.
 * @returns {Array(Object)} Array with the path between the top and bottom
 * elements, including the top and bottom.
 */
export function pathBetweenModels(top, bottom) {
  const path = [];
  if (top === bottom) return top ? [top] : path;
  let current = bottom;
  while (current && current !== top) {
    path.push(current);
    current = modelParent(current);
  }
  if (current === top) path.push(top);
  if (!current) return [];
  return path.reverse();
}

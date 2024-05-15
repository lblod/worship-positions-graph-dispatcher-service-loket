import * as rst from 'rdf-string-ttl';
//import * as sjp from 'sparqljson-parse';
//import * as mas from '@lblod/mu-auth-sudo';
import * as N3 from 'n3';
//import * as env from '../env';
import * as sts from './storeToTriplestore';
//import { NAMESPACES as ns } from '../env';
import model from '../config/hierarchicalModel';

let GENSYM_COUNTER = 0;

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

export function gensym(prefix = 'G_') {
  GENSYM_COUNTER++;
  if (GENSYM_COUNTER > 100000) GENSYM_COUNTER = 0;
  return `${prefix}${GENSYM_COUNTER}`;
}
export function gensymReset() {
  GENSYM_COUNTER = 0;
}

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

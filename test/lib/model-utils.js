import * as N3 from 'n3';
import * as mut from '../../lib/model-utils.js';
import { NAMESPACES as ns } from '../../env.js';
import model from '../../config/hierarchicalModel.js';
const { namedNode } = N3.DataFactory;
const { module, test } = QUnit;

module('model-utils', () => {
  module('findSubModelForType', () => {
    test('top element', (assert) => {
      assert.equal(
        mut.findSubModelForType(ns.ere`EredienstMandataris`),
        model[0],
      );
    });
    test('lower element', (assert) => {
      assert.equal(
        mut.findSubModelForType(ns.persoon`Geboorte`),
        model[0].children[0].children[0],
      );
    });
    test('non existing element', (assert) => {
      assert.equal(
        mut.findSubModelForType(ns.persoon`DoesNotExist`),
        undefined,
      );
    });
  });

  module('getSubModelsFlat', () => {
    test('top element', (assert) => {
      assert.deepEqual(mut.getSubModelsFlat(model), [
        model[0],
        model[0].children[0],
        model[0].children[1],
        model[0].children[0].children[0],
        model[0].children[0].children[1],
        model[0].children[1].children[0],
        model[1],
        model[1].children[0],
        model[1].children[1],
        model[1].children[0].children[0],
        model[1].children[0].children[1],
        model[1].children[1].children[0],
      ]);
    });
    test('first top tree', (assert) => {
      assert.deepEqual(mut.getSubModelsFlat(model[0]), [
        model[0],
        model[0].children[0],
        model[0].children[1],
        model[0].children[0].children[0],
        model[0].children[0].children[1],
        model[0].children[1].children[0],
      ]);
    });
    test('medium tree', (assert) => {
      assert.deepEqual(mut.getSubModelsFlat(model[0].children[0]), [
        model[0].children[0],
        model[0].children[0].children[0],
        model[0].children[0].children[1],
      ]);
    });
    test('small tree', (assert) => {
      assert.deepEqual(mut.getSubModelsFlat(model[0].children[0].children[0]), [
        model[0].children[0].children[0],
      ]);
    });
    test('non existing element', (assert) => {
      assert.deepEqual(mut.getSubModelsFlat(undefined), []);
    });
  });

  module('gensym', () => {
    test('first symbol', (assert) => {
      assert.equal(mut.gensym(), 'G_1');
    });
    test('second symbol', (assert) => {
      assert.equal(mut.gensym(), 'G_2');
    });
    test('custom prefix', (assert) => {
      assert.equal(mut.gensym('B_'), 'B_3');
    });
    //Not tested: rollover on the counter
    test('reset counter', (assert) => {
      mut.gensymReset();
      assert.equal(mut.gensym(), 'G_1');
    });
  });

  module('moduleParent', () => {
    test('model collection', (assert) => {
      assert.equal(mut.modelParent(model), undefined);
    });
    test('top element', (assert) => {
      assert.equal(mut.modelParent(model[0]), undefined);
    });
    test('middle element', (assert) => {
      assert.equal(mut.modelParent(model[0].children[0]), model[0]);
    });
    test('lower element', (assert) => {
      assert.equal(
        mut.modelParent(model[0].children[0].children[1]),
        model[0].children[0],
      );
    });
    test('non existing element', (assert) => {
      assert.equal(
        mut.modelParent({ type: 'someType', path: 'somePath' }),
        undefined,
      );
    });
  });

  module('pathBetweenModels', () => {
    test('same model collection', (assert) => {
      assert.deepEqual(mut.pathBetweenModels(model, model), [model]);
    });
    test('same model', (assert) => {
      assert.deepEqual(mut.pathBetweenModels(model[0], model[0]), [model[0]]);
    });
    test('short path', (assert) => {
      assert.deepEqual(mut.pathBetweenModels(model[0], model[0].children[0]), [
        model[0],
        model[0].children[0],
      ]);
    });
    test('long path', (assert) => {
      assert.deepEqual(
        mut.pathBetweenModels(model[0], model[0].children[0].children[1]),
        [model[0], model[0].children[0], model[0].children[0].children[1]],
      );
    });
    test('short path from the middle', (assert) => {
      assert.deepEqual(
        mut.pathBetweenModels(
          model[0].children[0],
          model[0].children[0].children[1],
        ),
        [model[0].children[0], model[0].children[0].children[1]],
      );
    });
  });

  module('createQueryForPath', (hooks) => {
    hooks.beforeEach(() => {
      mut.gensymReset();
    });
    test('path is only 1 long', (assert) => {
      const path = mut.pathBetweenModels(model[0], model[0]);
      let query = mut.createQueryForPath(
        path,
        namedNode('http://subject/uri'),
        namedNode('http://vendor/uri'),
      );
      query = query.replace(/\s+/g, ' ').trim();
      const control =
        'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> CONSTRUCT { ?v1 ?v2 ?v3 . } WHERE { BIND (<http://subject/uri> as ?v1) ?v1 rdf:type <http://data.lblod.info/vocabularies/erediensten/EredienstMandataris> . ?v1 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v1 ?v2 ?v3 . }';
      assert.equal(query, control);
    });
    test('path is 2 long', (assert) => {
      const path = mut.pathBetweenModels(model[0], model[0].children[0]);
      let query = mut.createQueryForPath(
        path,
        namedNode('http://subject/uri'),
        namedNode('http://vendor/uri'),
      );
      query = query.replace(/\s+/g, ' ').trim();
      const control =
        'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> CONSTRUCT { ?v2 ?v3 ?v4 . } WHERE { BIND (<http://subject/uri> as ?v1) ?v1 <http://data.vlaanderen.be/ns/mandaat#isBestuurlijkeAliasVan> ?v2 . ?v1 rdf:type <http://data.lblod.info/vocabularies/erediensten/EredienstMandataris> . ?v1 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v2 rdf:type <http://www.w3.org/ns/person#Persoon> . ?v2 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v2 ?v3 ?v4 . }';
      assert.equal(query, control);
    });
    test('path is 3 long', (assert) => {
      const path = mut.pathBetweenModels(
        model[0],
        model[0].children[0].children[0],
      );
      let query = mut.createQueryForPath(
        path,
        namedNode('http://subject/uri'),
        namedNode('http://vendor/uri'),
      );
      query = query.replace(/\s+/g, ' ').trim();
      const control =
        'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> CONSTRUCT { ?v3 ?v4 ?v5 . } WHERE { BIND (<http://subject/uri> as ?v1) ?v1 <http://data.vlaanderen.be/ns/mandaat#isBestuurlijkeAliasVan> ?v2 . ?v2 <http://data.vlaanderen.be/ns/persoon#heeftGeboorte> ?v3 . ?v1 rdf:type <http://data.lblod.info/vocabularies/erediensten/EredienstMandataris> . ?v1 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v2 rdf:type <http://www.w3.org/ns/person#Persoon> . ?v2 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v3 rdf:type <http://data.vlaanderen.be/ns/persoon#Geboorte> . ?v3 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v3 ?v4 ?v5 . }';
      assert.equal(query, control);
    });
  });

  module('createQueriesForSubmodel', (hooks) => {
    hooks.beforeEach(() => {
      mut.gensymReset();
    });
    test('top level', (assert) => {
      let queries = mut.createQueriesForSubmodel(
        namedNode('http://subject/uri'),
        namedNode(
          'http://data.lblod.info/vocabularies/erediensten/EredienstMandataris',
        ),
        namedNode('http://vendor/uri'),
      );
      queries = queries.map((q) => {
        return q.replace(/\s+/g, ' ').trim();
      });
      const control = [
        'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> CONSTRUCT { ?v1 ?v2 ?v3 . } WHERE { BIND (<http://subject/uri> as ?v1) ?v1 rdf:type <http://data.lblod.info/vocabularies/erediensten/EredienstMandataris> . ?v1 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v1 ?v2 ?v3 . }',
        'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> CONSTRUCT { ?v5 ?v6 ?v7 . } WHERE { BIND (<http://subject/uri> as ?v4) ?v4 <http://data.vlaanderen.be/ns/mandaat#isBestuurlijkeAliasVan> ?v5 . ?v4 rdf:type <http://data.lblod.info/vocabularies/erediensten/EredienstMandataris> . ?v4 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v5 rdf:type <http://www.w3.org/ns/person#Persoon> . ?v5 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v5 ?v6 ?v7 . }',
        'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> CONSTRUCT { ?v9 ?v10 ?v11 . } WHERE { BIND (<http://subject/uri> as ?v8) ?v8 <http://schema.org/contactPoint> ?v9 . ?v8 rdf:type <http://data.lblod.info/vocabularies/erediensten/EredienstMandataris> . ?v8 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v9 rdf:type <http://schema.org/ContactPoint> . ?v9 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v9 ?v10 ?v11 . }',
        'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> CONSTRUCT { ?v14 ?v15 ?v16 . } WHERE { BIND (<http://subject/uri> as ?v12) ?v12 <http://data.vlaanderen.be/ns/mandaat#isBestuurlijkeAliasVan> ?v13 . ?v13 <http://data.vlaanderen.be/ns/persoon#heeftGeboorte> ?v14 . ?v12 rdf:type <http://data.lblod.info/vocabularies/erediensten/EredienstMandataris> . ?v12 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v13 rdf:type <http://www.w3.org/ns/person#Persoon> . ?v13 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v14 rdf:type <http://data.vlaanderen.be/ns/persoon#Geboorte> . ?v14 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v14 ?v15 ?v16 . }',
        'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> CONSTRUCT { ?v19 ?v20 ?v21 . } WHERE { BIND (<http://subject/uri> as ?v17) ?v17 <http://data.vlaanderen.be/ns/mandaat#isBestuurlijkeAliasVan> ?v18 . ?v18 <http://www.w3.org/ns/adms#identifier> ?v19 . ?v17 rdf:type <http://data.lblod.info/vocabularies/erediensten/EredienstMandataris> . ?v17 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v18 rdf:type <http://www.w3.org/ns/person#Persoon> . ?v18 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v19 rdf:type <http://www.w3.org/ns/adms#Identifier> . ?v19 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v19 ?v20 ?v21 . }',
        'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> CONSTRUCT { ?v24 ?v25 ?v26 . } WHERE { BIND (<http://subject/uri> as ?v22) ?v22 <http://schema.org/contactPoint> ?v23 . ?v23 <http://www.w3.org/ns/locn#address> ?v24 . ?v22 rdf:type <http://data.lblod.info/vocabularies/erediensten/EredienstMandataris> . ?v22 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v23 rdf:type <http://schema.org/ContactPoint> . ?v23 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v24 rdf:type <http://www.w3.org/ns/locn#Address> . ?v24 <http://www.w3.org/ns/prov#wasAssociatedWith> <http://vendor/uri> . ?v24 ?v25 ?v26 . }',
      ];
      assert.deepEqual(queries, control);
    });
  });
});

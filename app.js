import bodyParser from 'body-parser';
import { app } from 'mu';
import { BASES as b } from './env';
import { v4 as uuid } from 'uuid';
import { NAMESPACES as ns } from './env';
import * as mas from '@lblod/mu-auth-sudo';
import * as rst from 'rdf-string-ttl';
import * as env from './env';
import * as del from './deltaProcessing';
import { Lock } from 'async-await-mutex-lock';
import * as N3 from 'n3';
const { namedNode, literal } = N3.DataFactory;

app.use(
  bodyParser.json({
    type: function (req) {
      return /^application\/json/.test(req.get('content-type'));
    },
    limit: '50mb',
    extended: true,
  })
);

app.get('/', function (req, res) {
  res.send('Hello from worship-positions-graph-dispatcher-service-loket');
});

/**
 * When the service starts, make it do a scan of the inserts and deletes to
 * first clear out those graphs as much as possible.
 */
setTimeout(async () => {
  try {
    await lock.acquire();
    const results = await del.scanAndProcess();
    handleProcessingResult(results);
  } catch (err) {
    await logError(err);
  } finally {
    lock.release();
  }
}, 0);

/**
 * This is a lock to make sure requests are only processed one by one. This is
 * to make sure requests are not touching the data of other requests. Although
 * that is allowed (it wont break the data), we don't want to be wasteful with
 * queries.
 *
 * @global
 */
const lock = new Lock();

app.post('/delta-inserts', async function (req, res, next) {
  // We can already send a 200 back. The delta-notifier does not care about the
  // result, as long as the request is closed.
  res.status(200).end();
  try {
    await lock.acquire();
    const changesets = req.body;
    const result = await del.processDeltaChangesets(changesets);
    handleProcessingResult(result);
  } catch (err) {
    next(err);
  } finally {
    lock.release();
  }
});

app.post('/delta-deletes', async function (req, res, next) {
  // We can already send a 200 back. The delta-notifier does not care about the
  // result, as long as the request is closed.
  res.status(200).end();
  try {
    await lock.acquire();
    const changesets = req.body;
    //Deletes are actually inserts in the temporary deletes graph. Move them
    //over to deletes and remove the inserts to trick the delta processor.
    for (const changeset of changesets) {
      changeset.deletes = changeset.deletes.concat(changeset.inserts);
      changeset.inserts = [];
    }
    const result = await del.processDeltaChangesets(changesets);
    handleProcessingResult(result);
  } catch (err) {
    next(err);
  } finally {
    lock.release();
  }
});

app.post('/manual-dispatch', async function (req, res, next) {
  // We can already send a 200 back. The delta-notifier does not care about the
  // result, as long as the request is closed.
  res.status(200).end();
  try {
    await lock.acquire();
    const results = await del.scanAndProcess();
    handleProcessingResult(results);
  } catch (err) {
    next(err);
  } finally {
    lock.release();
  }
});

///////////////////////////////////////////////////////////////////////////////
// Error handler
///////////////////////////////////////////////////////////////////////////////

// For some reason the 'next' parameter is unused and eslint notifies us, but
// when removed, Express does not use this middleware anymore.
/* eslint-disable no-unused-vars */
app.use(async (err, req, res, next) => {
  await logError(err);
});
/* eslint-enable no-unused-vars */

async function logError(err) {
  //TODO remove next line in production
  console.error(err);
  if (env.LOGLEVEL === 'error') console.error(err);
  if (env.WRITE_ERRORS === true) {
    const errorStore = errorToStore(err);
    await writeError(errorStore);
  }
}

///////////////////////////////////////////////////////////////////////////////
// Helpers
///////////////////////////////////////////////////////////////////////////////

/*
 * Produces an RDF store with the data to encode an error in the OSLC
 * namespace.
 *
 * @function
 * @param {Error} errorObject - Instance of the standard JavaScript Error class
 * or similar object that has a `message` property.
 * @returns {N3.Store} A new Store with the properties to represent the error.
 */
function errorToStore(errorObject) {
  const store = new N3.Store();
  const errorUuid = uuid();
  const error = b.error(errorUuid);
  store.addQuad(error, ns.rdf`type`, ns.oslc`Error`);
  store.addQuad(error, ns.mu`uuid`, literal(errorUuid));
  store.addQuad(error, ns.oslc`message`, literal(errorObject.message));
  return store;
}

/*
 * Receives a store with only the triples related to error messages and stores
 * them in the triplestore.
 *
 * @async
 * @function
 * @param {N3.Store} errorStore - Store with only error triples. (All of the
 * contents are stored.)
 * @returns {undefined} Nothing
 */
async function writeError(errorStore) {
  const writer = new N3.Writer();
  errorStore.forEach((q) => writer.addQuad(q));
  const errorTriples = await new Promise((resolve, reject) => {
    writer.end((err, res) => {
      if (err) reject(err);
      resolve(res);
    });
  });
  await mas.updateSudo(`
    INSERT DATA {
      GRAPH ${rst.termToString(namedNode(env.ERROR_GRAPH))} {
        ${errorTriples}
      }
    }
  `);
}

/*
 * The pocessing of delta messages should return an object with a potential
 * information message. This function prints the message when the loglevel
 * requests for that.
 *
 * @function
 * @param {Object} results - A JavaScript object with keys `success` (Boolean)
 * and `reason` (String). When not successful, the reason is printed according
 * to the loglevel.
 * @returns {undefined} Nothing
 */
function handleProcessingResult(results) {
  if (env.LOGLEVEL === 'info') {
    const insertsResults = results.inserts;
    const deletesResults = results.deletes;
    for (const coll of [deletesResults, insertsResults]) {
      for (const res of coll) {
        if (res.subject) res.subject = res.subject.value;
        if (res.type) res.type = res.type.value;
        if (res.organisationGraph)
          res.organisationGraph = res.organisationGraph.value;
        if (res.organisationUUIDs)
          res.organisationUUIDs = res.organisationUUIDs.join(',');
        if (res.triple) res.triple = del.formatTriple(res.triple);
        if (res.graphs) res.graphs = res.graphs.join(',');
        console.log(res);
      }
    }
  }
}

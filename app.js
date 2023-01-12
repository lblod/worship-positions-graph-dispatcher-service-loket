import bodyParser from 'body-parser';
import { app } from 'mu';

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

app.post("/delta", async function (req, res) {
  
});

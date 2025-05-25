const express = require('express');
const bodyParser = require('body-parser');
const basicAuth = require('basic-auth');
const grafanaRouter = require('./grafanaRouter');
const config = require('./config');

const app = express();

// Basic Auth middleware
app.use((req, res, next) => {
  const user = basicAuth(req);
  if (!user || user.name !== config.proxy.username || user.pass !== config.proxy.password) {
    res.set('WWW-Authenticate', 'Basic realm="GrafanaDataProxy"');
    return res.status(401).send('Authentication required.');
  }
  next();
});

app.use(bodyParser.json());
app.use('/', grafanaRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Internal Server Error');
});

app.listen(config.proxy.port, () => {
  console.log(`SCADA Grafana Proxy listening on port ${config.proxy.port}`);
});

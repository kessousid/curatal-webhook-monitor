require('dotenv').config();
const express = require('express');
const path = require('path');
const { init } = require('./db');
const heartbeatRouter = require('./heartbeat');
const apiRouter = require('./routes/api');
const scheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', apiRouter);
app.use(heartbeatRouter);

app.get('/health', (req, res) => res.status(200).send('ok'));

async function main() {
  await init();
  scheduler.start();
  app.listen(PORT, () => console.log(`Webhook monitor listening on ${PORT}`));
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});

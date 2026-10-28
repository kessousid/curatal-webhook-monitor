const express = require('express');
const { pool } = require('./db');

const router = express.Router();

// Curatal's existing Razorpay webhook handler can optionally POST here (fire-and-forget)
// after it accepts a webhook, so this service can report heartbeat recency in the daily
// digest — not just receiver downtime. See README for the snippet.
router.post('/heartbeat', express.json(), async (req, res) => {
  const { event_type, meta } = req.body || {};
  await pool.query(
    `INSERT INTO webhook_heartbeats (source, event_type, raw_meta) VALUES ($1,$2,$3)`,
    ['razorpay', event_type || null, meta ? JSON.stringify(meta) : null]
  );
  res.status(204).end();
});

module.exports = router;

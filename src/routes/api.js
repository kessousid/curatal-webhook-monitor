const express = require('express');
const { pool } = require('../db');
const { enabled: crossCheckEnabled } = require('../razorpayCrossCheck');
const { parseTargets } = require('../targets');

const router = express.Router();

router.get('/status', async (req, res) => {
  const targets = parseTargets();

  const [targetLatest, lastHeartbeat, openAlerts, recentChecks] = await Promise.all([
    Promise.all(
      targets.map((t) =>
        pool
          .query(`SELECT * FROM health_checks WHERE target_url = $1 ORDER BY checked_at DESC LIMIT 1`, [t.url])
          .then((r) => r.rows[0] || null)
      )
    ),
    pool.query(`SELECT * FROM webhook_heartbeats ORDER BY received_at DESC LIMIT 1`),
    pool.query(`SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY created_at DESC`),
    pool.query(
      `SELECT target_url, checked_at, success, status_code, latency_ms, error FROM health_checks ORDER BY checked_at DESC LIMIT 50`
    ),
  ]);

  res.json({
    environment: process.env.RAILWAY_ENVIRONMENT_NAME || null,
    targets: targets.map((t, i) => ({
      name: t.name,
      url: t.url,
      method: t.method,
      last_check: targetLatest[i],
    })),
    cross_check_enabled: crossCheckEnabled,
    last_heartbeat: lastHeartbeat.rows[0] || null,
    open_alerts: openAlerts.rows,
    recent_checks: recentChecks.rows,
  });
});

router.get('/alerts', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM alerts ORDER BY created_at DESC LIMIT 100`);
  res.json(rows);
});

module.exports = router;

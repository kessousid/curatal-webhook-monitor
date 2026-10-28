const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : undefined,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id SERIAL PRIMARY KEY,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      target_url TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      status_code INTEGER,
      latency_ms INTEGER,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS webhook_heartbeats (
      id SERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      source TEXT,
      event_type TEXT,
      raw_meta JSONB
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      resolved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS digest_log (
      id SERIAL PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_health_checks_checked_at ON health_checks (checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_heartbeats_received_at ON webhook_heartbeats (received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts (kind) WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_digest_log_sent_at ON digest_log (sent_at DESC);
  `);

  // One-time cleanup: 'webhook_silence' is retired (it re-alerted hourly forever
  // instead of being folded into the daily digest) — close out any rows still
  // open from before so they don't linger in "open alerts" forever. Harmless to
  // run on every boot since no new rows of this kind are ever created anymore.
  await pool.query(`UPDATE alerts SET resolved_at = now() WHERE kind = 'webhook_silence' AND resolved_at IS NULL`);
}

module.exports = { pool, init };

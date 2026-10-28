const nodemailer = require('nodemailer');
const { pool } = require('./db');

const ALERT_TO = process.env.ALERT_EMAIL_TO;
const ALERT_CC = process.env.ALERT_EMAIL_CC;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const REALERT_MINUTES = parseInt(process.env.REALERT_MINUTES || '60', 10);
// Railway sets this automatically per environment (e.g. "production", "staging") —
// included in every alert subject so a staging test run is never mistaken for prod.
const ENV_NAME = process.env.RAILWAY_ENVIRONMENT_NAME || 'unknown';

const transporter = GMAIL_USER && GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    })
  : null;

// `to`/`cc` default to ALERT_EMAIL_TO so existing alert call sites are unaffected;
// pass overrides for a call site that needs different recipients (e.g. the digest).
async function sendMail(subject, text, { to = ALERT_TO, cc = ALERT_CC } = {}) {
  if (!transporter || !to) {
    console.warn('[alerts] email not configured, skipping send:', subject);
    return;
  }
  await transporter.sendMail({
    from: GMAIL_USER,
    to,
    cc,
    subject: `[Webhook Monitor · ${ENV_NAME}] ${subject}`,
    text,
  });
}

// Raises an alert of `kind` if none is currently open, so a failing check every
// few minutes doesn't send a fresh email each time. Re-notifies every
// REALERT_MINUTES while the condition persists.
async function raiseAlert(kind, message) {
  const { rows } = await pool.query(
    `SELECT id, created_at FROM alerts WHERE kind = $1 AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [kind]
  );
  const open = rows[0];

  if (!open) {
    await pool.query(`INSERT INTO alerts (kind, message) VALUES ($1, $2)`, [kind, message]);
    await sendMail(`ALERT: ${kind}`, message);
    return;
  }

  const ageMinutes = (Date.now() - new Date(open.created_at).getTime()) / 60000;
  if (ageMinutes >= REALERT_MINUTES) {
    await pool.query(`INSERT INTO alerts (kind, message) VALUES ($1, $2)`, [kind, message]);
    await sendMail(`STILL FAILING: ${kind}`, message);
  }
}

// Like raiseAlert, but never re-notifies while the alert stays open — one email
// on the initial transition, then silence until resolveAlert closes it out.
// Used for signals that are a confirmed fact rather than an inferred one (e.g.
// Razorpay reporting the webhook itself as disabled), where a repeat email
// every REALERT_MINUTES would just restate the same known state.
async function raiseAlertOnce(kind, message) {
  const { rows } = await pool.query(
    `SELECT id FROM alerts WHERE kind = $1 AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [kind]
  );
  if (rows[0]) return;

  await pool.query(`INSERT INTO alerts (kind, message) VALUES ($1, $2)`, [kind, message]);
  await sendMail(`ALERT: ${kind}`, message);
}

async function resolveAlert(kind, message) {
  const { rows } = await pool.query(
    `SELECT id FROM alerts WHERE kind = $1 AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [kind]
  );
  if (rows[0]) {
    await pool.query(`UPDATE alerts SET resolved_at = now() WHERE id = $1`, [rows[0].id]);
    await sendMail(`RECOVERED: ${kind}`, message);
  }
}

module.exports = { raiseAlert, raiseAlertOnce, resolveAlert, sendMail };

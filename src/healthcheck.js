const { pool } = require('./db');
const { raiseAlert, resolveAlert } = require('./alerts');
const { parseTargets } = require('./targets');

const FAILURE_THRESHOLD = parseInt(process.env.HEALTH_CHECK_FAILURE_THRESHOLD || '3', 10);
const TIMEOUT_MS = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '10000', 10);

// Treats network errors/timeouts and 5xx responses as "down" — that's exactly what
// drives Razorpay's 24h retry-then-disable behavior. Non-5xx (even 4xx) proves the
// process is alive and handling requests, so it counts as "up".
async function checkTarget(target) {
  const start = Date.now();
  let success = false;
  let statusCode = null;
  let error = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(target.url, {
      method: target.method,
      headers: target.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: target.method === 'POST' ? '{}' : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    statusCode = res.status;
    success = res.status < 500;
  } catch (err) {
    error = err.message;
  }

  const latencyMs = Date.now() - start;
  await pool.query(
    `INSERT INTO health_checks (target_url, success, status_code, latency_ms, error) VALUES ($1,$2,$3,$4,$5)`,
    [target.url, success, statusCode, latencyMs, error]
  );

  if (success) {
    await resolveAlert(target.alertKind, `${target.name} (${target.url}) is responding normally again.`);
    return;
  }

  const { rows } = await pool.query(
    `SELECT success FROM health_checks WHERE target_url = $1 ORDER BY checked_at DESC LIMIT $2`,
    [target.url, FAILURE_THRESHOLD]
  );
  const consecutiveFailures = rows.length === FAILURE_THRESHOLD && rows.every((r) => !r.success);

  if (consecutiveFailures) {
    const razorpayNote =
      target.name === 'webhook'
        ? ' Razorpay disables a webhook after 24h of continuous delivery failures — fix the receiver before that window elapses.'
        : '';
    await raiseAlert(
      target.alertKind,
      `${target.name} (${target.url}) has failed ${FAILURE_THRESHOLD} consecutive health checks. ` +
        `Last error: ${error || `HTTP ${statusCode}`}.${razorpayNote}`
    );
  }
}

async function runHealthChecks() {
  const targets = parseTargets();
  if (!targets.length) {
    console.warn('[healthcheck] no targets configured, skipping');
    return;
  }
  for (const target of targets) {
    await checkTarget(target).catch((err) =>
      console.error(`[healthcheck] error checking ${target.name}`, err)
    );
  }
}

module.exports = { runHealthChecks };

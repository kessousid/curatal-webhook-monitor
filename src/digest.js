const { pool } = require('./db');
const { sendMail } = require('./alerts');
const { parseTargets } = require('./targets');
const { enabled: razorpayEnabled, fetchRecentPayments, fetchWebhookStatus } = require('./razorpayCrossCheck');

// Routine status digest — separate from failure alerts (alerts.js), which fire
// only on state changes. This reports Razorpay payment activity + receiver
// health regardless of whether anything is wrong, capped to one send per
// DIGEST_INTERVAL_HOURS via digest_log so restarts/multiple cron ticks can
// never double-send.
const DIGEST_INTERVAL_HOURS = parseInt(process.env.DIGEST_INTERVAL_HOURS || '24', 10);
// Falls back to ALERT_EMAIL_TO (via sendMail's default) if unset.
const DIGEST_EMAIL_TO = process.env.DIGEST_EMAIL_TO;
const DIGEST_EMAIL_CC = process.env.DIGEST_EMAIL_CC;

async function buildDigestBody() {
  const targets = parseTargets();
  const windowMinutes = DIGEST_INTERVAL_HOURS * 60;
  const primaryTarget = targets.find((t) => t.name === 'webhook');

  const [latestChecks, lastHeartbeatResult, openAlertsResult, payments, webhookStatus] = await Promise.all([
    Promise.all(
      targets.map((t) =>
        pool
          .query(`SELECT * FROM health_checks WHERE target_url = $1 ORDER BY checked_at DESC LIMIT 1`, [t.url])
          .then((r) => r.rows[0] || null)
      )
    ),
    pool.query(`SELECT * FROM webhook_heartbeats ORDER BY received_at DESC LIMIT 1`),
    pool.query(`SELECT kind, message, created_at FROM alerts WHERE resolved_at IS NULL ORDER BY created_at DESC`),
    fetchRecentPayments(windowMinutes),
    primaryTarget ? fetchWebhookStatus(primaryTarget.url) : null,
  ]);

  const lines = [];

  // Webhook status — ground truth from Razorpay's own config, not inferred
  // from delivery silence. The strongest possible signal: disabled means
  // payments are being generated with zero webhook deliveries, full stop.
  lines.push('Webhook status:');
  if (!razorpayEnabled) {
    lines.push('  - Not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set) — cannot check.');
  } else if (!webhookStatus) {
    lines.push('  - Could not determine status this run (see service logs).');
  } else if (webhookStatus.active) {
    lines.push('  - ACTIVE — Razorpay is delivering webhooks normally.');
  } else {
    const disabledNote = webhookStatus.disabledAt ? ` since ${webhookStatus.disabledAt.toISOString()}` : '';
    lines.push(
      `  - DISABLED${disabledNote} — Razorpay has stopped delivering webhooks. Re-enable in ` +
        'Razorpay Dashboard > Webhooks.'
    );
  }

  // Razorpay payment activity — did any money move, and if so, did a webhook
  // actually arrive for it.
  lines.push('', 'Razorpay payments:');
  if (!razorpayEnabled) {
    lines.push('  - Cross-check not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set) — cannot report payment status.');
  } else if (payments === null) {
    lines.push('  - Could not reach the Razorpay Payments API this run (see service logs).');
  } else if (payments.length === 0) {
    lines.push(`  - No payments were made via Razorpay in the last ${DIGEST_INTERVAL_HOURS}h.`);
  } else {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM webhook_heartbeats WHERE received_at >= now() - ($1 || ' minutes')::interval`,
      [windowMinutes]
    );
    const heartbeatCount = parseInt(rows[0].count, 10);
    lines.push(
      `  - ${payments.length} payment(s) made in the last ${DIGEST_INTERVAL_HOURS}h; ` +
        `${heartbeatCount} webhook heartbeat(s) received in that window.`
    );
    if (heartbeatCount === 0) {
      lines.push(
        '  - WARNING: payments were made but no webhook heartbeats were recorded — the receiver ' +
          'may be failing silently. Check Razorpay Dashboard > Webhooks.'
      );
    }

    const MAX_LISTED = 25;
    lines.push('', '  Payment details:');
    payments.slice(0, MAX_LISTED).forEach((p, i) => {
      const amount = (p.amount / 100).toFixed(2);
      const contact = p.email || p.contact || 'no contact on file';
      const when = new Date(p.created_at * 1000).toISOString();
      lines.push(
        `    ${i + 1}. ${p.id} — ${amount} ${p.currency} — ${p.method || 'method n/a'} — ` +
          `${p.status} — ${contact} — ${when}`
      );
    });
    if (payments.length > MAX_LISTED) {
      lines.push(`    ... and ${payments.length - MAX_LISTED} more — see Razorpay Dashboard for the full list.`);
    }
  }

  const heartbeat = lastHeartbeatResult.rows[0];
  lines.push(
    '',
    heartbeat
      ? `Last webhook heartbeat: ${Math.round((Date.now() - new Date(heartbeat.received_at).getTime()) / 60000)} minutes ago (${heartbeat.received_at.toISOString()}).`
      : 'Last webhook heartbeat: none recorded yet.'
  );

  lines.push('', 'Receiver health:');
  if (!targets.length) {
    lines.push('  - no health check targets configured');
  }
  targets.forEach((t, i) => {
    const check = latestChecks[i];
    if (!check) {
      lines.push(`  - ${t.name} (${t.url}): no checks recorded yet`);
      return;
    }
    const status = check.success ? 'UP' : 'DOWN';
    const detail = check.error ? `, error: ${check.error}` : '';
    lines.push(
      `  - ${t.name} (${t.url}): ${status} (last checked ${check.checked_at.toISOString()}, ` +
        `HTTP ${check.status_code ?? 'n/a'}, ${check.latency_ms}ms)${detail}`
    );
  });

  const openAlerts = openAlertsResult.rows;
  lines.push('');
  if (openAlerts.length) {
    lines.push(`Open alerts (${openAlerts.length}):`);
    openAlerts.forEach((a) => lines.push(`  - [${a.kind}] ${a.message} (since ${a.created_at.toISOString()})`));
  } else {
    lines.push('No open alerts.');
  }

  return lines.join('\n');
}

async function sendDigestNow() {
  const body = await buildDigestBody();
  await sendMail('Daily status digest', body, { to: DIGEST_EMAIL_TO, cc: DIGEST_EMAIL_CC });
  await pool.query(`INSERT INTO digest_log (sent_at) VALUES (now())`);
}

async function sendDailyDigestIfDue() {
  const { rows } = await pool.query(`SELECT sent_at FROM digest_log ORDER BY sent_at DESC LIMIT 1`);
  const last = rows[0]?.sent_at;
  if (last) {
    const hoursSince = (Date.now() - new Date(last).getTime()) / 3600000;
    if (hoursSince < DIGEST_INTERVAL_HOURS) return;
  }

  await sendDigestNow();
}

module.exports = { sendDailyDigestIfDue };

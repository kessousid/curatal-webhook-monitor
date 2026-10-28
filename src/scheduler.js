const cron = require('node-cron');
const { runHealthChecks } = require('./healthcheck');
const { sendDailyDigestIfDue } = require('./digest');
const { checkWebhookStatus } = require('./webhookStatusMonitor');
const { enabled: razorpayEnabled } = require('./razorpayCrossCheck');

const HEALTH_CHECK_INTERVAL_MINUTES = parseInt(process.env.HEALTH_CHECK_INTERVAL_MINUTES || '5', 10);

function start() {
  cron.schedule(`*/${HEALTH_CHECK_INTERVAL_MINUTES} * * * *`, () => {
    runHealthChecks().catch((err) => console.error('[scheduler] healthcheck error', err));
  });

  // Ticks hourly, but sendDailyDigestIfDue enforces the actual send cadence via
  // digest_log — keeps the "one email per DIGEST_INTERVAL_HOURS" guarantee even
  // across restarts, unlike a fixed once-daily cron time would. This digest is
  // also where Razorpay payment activity and webhook heartbeat recency are
  // reported — there is no separate recurring alert for those anymore, since a
  // fixed re-alert cooldown (REALERT_MINUTES) sent an email every hour for as
  // long as the underlying condition persisted.
  cron.schedule('0 * * * *', () => {
    sendDailyDigestIfDue().catch((err) => console.error('[scheduler] daily digest error', err));
  });

  if (razorpayEnabled) {
    cron.schedule('*/15 * * * *', () => {
      checkWebhookStatus().catch((err) => console.error('[scheduler] webhook status check error', err));
    });
    console.log('[scheduler] Razorpay webhook status monitoring enabled');
  } else {
    console.log('[scheduler] Razorpay webhook status monitoring disabled (no RAZORPAY_KEY_ID/SECRET set)');
  }
}

module.exports = { start };

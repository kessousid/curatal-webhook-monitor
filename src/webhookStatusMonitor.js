const { parseTargets } = require('./targets');
const { fetchWebhookStatus } = require('./razorpayCrossCheck');
const { raiseAlertOnce, resolveAlert } = require('./alerts');

// Polls Razorpay's own webhook config for the primary webhook target. Fires
// once, immediately, when it transitions to disabled — not a repeating alert,
// since "disabled" is a fact that stays true until someone acts on it, and a
// re-alert every REALERT_MINUTES would just restate the same known state.
async function checkWebhookStatus() {
  const target = parseTargets().find((t) => t.name === 'webhook');
  if (!target) return;

  const status = await fetchWebhookStatus(target.url);
  if (!status) return;

  if (status.active) {
    await resolveAlert('webhook_disabled', `Razorpay webhook for ${target.url} is active again.`);
    return;
  }

  const disabledNote = status.disabledAt ? ` (disabled at ${status.disabledAt.toISOString()})` : '';
  await raiseAlertOnce(
    'webhook_disabled',
    `Razorpay has disabled the webhook for ${target.url}${disabledNote}. Payments will not generate ` +
      `any webhook deliveries until this is manually re-enabled in Razorpay Dashboard > Webhooks.`
  );
}

module.exports = { checkWebhookStatus };

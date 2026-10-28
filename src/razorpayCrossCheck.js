const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

const enabled = Boolean(KEY_ID && KEY_SECRET);

// Fetches captured/authorized Razorpay payments from the last `windowMinutes`
// via the standard Payments API (works with a normal merchant key). Returns
// null if not configured or the request failed, so callers can distinguish
// "not configured" / "couldn't check" from a genuine zero-payment window.
async function fetchRecentPayments(windowMinutes) {
  if (!enabled) return null;

  const from = Math.floor((Date.now() - windowMinutes * 60000) / 1000);
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');

  const res = await fetch(`https://api.razorpay.com/v1/payments?from=${from}&count=100`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    console.error('[razorpay] payments request failed', res.status);
    return null;
  }

  const data = await res.json();
  return (data.items || []).filter((p) => p.status === 'captured' || p.status === 'authorized');
}

// Fetches the actual enabled/disabled state of the webhook at `url` straight
// from Razorpay's own config (Webhooks API) — ground truth, not an inference
// from delivery silence. Returns null if not configured, the request failed,
// or no webhook matches that URL.
async function fetchWebhookStatus(url) {
  if (!enabled || !url) return null;

  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/webhooks?count=100', {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    console.error('[razorpay] webhooks request failed', res.status);
    return null;
  }

  const data = await res.json();
  const webhook = (data.items || []).find((w) => w.url === url);
  if (!webhook) return null;

  return {
    active: webhook.active,
    disabledAt: webhook.disabled_at ? new Date(webhook.disabled_at * 1000) : null,
  };
}

module.exports = { enabled, fetchRecentPayments, fetchWebhookStatus };

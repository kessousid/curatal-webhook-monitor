# Curatal Webhook Monitor

Monitors curatal's Razorpay payment webhook health so a receiver outage gets caught
before Razorpay's 24-hour failure window auto-disables the webhook (which then
requires a manual re-enable in the Razorpay Dashboard).

## What it does

- **Health checks** (`HEALTH_CHECK_INTERVAL_MINUTES`, default 5): pings `WEBHOOK_ENDPOINT_URL`.
  Alerts immediately after `HEALTH_CHECK_FAILURE_THRESHOLD` consecutive failures — this is
  one of two alerts that still email right away, since it means the receiver is down *now*.
- **Webhook status monitoring** (every 15 min, requires `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`):
  checks the webhook's actual `active`/disabled state via Razorpay's Webhooks API — ground
  truth from Razorpay itself, not inferred from delivery silence. Fires an immediate email
  the moment it flips to disabled (payments are being generated with zero webhook deliveries
  at that point), then goes quiet — no repeat emails while it stays disabled, since that's a
  known, unchanging fact until someone re-enables it in the Dashboard. One recovery email
  when it's re-enabled. Current status also appears in the daily digest below.
- **Email alerts** via Gmail SMTP (App Password), sent to `ALERT_EMAIL_TO`/`ALERT_EMAIL_CC`,
  with re-alert cooldown (`REALERT_MINUTES`) so a persistent receiver-down failure doesn't
  spam your inbox.
- **Daily status digest**: one routine email every `DIGEST_INTERVAL_HOURS` (default 24),
  strictly capped to one send per interval (tracked in `digest_log`, so restarts or extra
  cron ticks can't double-send). Sent to `DIGEST_EMAIL_TO`/`DIGEST_EMAIL_CC` if set, otherwise
  falls back to `ALERT_EMAIL_TO`/`ALERT_EMAIL_CC` — set the digest vars only if you want a
  different distribution list than immediate alerts. Reports:
  - **Webhook status** (requires `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`): active or disabled,
    same signal as the immediate alert above.
  - **Razorpay payment activity** (requires `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`): whether
    any payments were made in the window, and whether webhook heartbeats were received for
    them — payments with zero webhooks is flagged as the strongest signal something is broken.
    If no payments were made, the digest says so plainly rather than treating it as an alert.
    Per-payment details (id, amount, method, status, payer contact, timestamp) are listed for
    up to 25 payments; beyond that it just gives a count and points to the Razorpay Dashboard.
  - Webhook heartbeat recency (if you wire the `/heartbeat` call below into your real handler).
  - Receiver health per target, and any open alerts.

  There is no separate recurring "webhook silence" alert anymore — it used to re-email every
  `REALERT_MINUTES` for as long as no heartbeat arrived, which produced an email every hour
  regardless of whether that actually meant anything was wrong. That signal now only shows up
  once a day, in the digest, alongside the Razorpay payment context needed to judge it.
- **Dashboard** at `/` — current status, open alerts, recent check history.

## Wiring the heartbeat into your real webhook handler

Add this to curatal's existing Razorpay webhook route, right after signature
verification succeeds:

```js
fetch('https://<this-service-domain>/heartbeat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event_type: req.body.event }),
}).catch(() => {}); // never let monitoring affect webhook processing
```

Fire-and-forget — don't `await` it on the critical path, and swallow errors so this
service being down can never break real webhook processing.

## Environment variables

See `.env.example`. `DATABASE_URL` is wired automatically on Railway via a variable
reference to the Postgres service. Set secrets (`GMAIL_APP_PASSWORD`, and optionally
`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`) directly in the Railway dashboard, not in
source control.

Gmail App Password: generate one at https://myaccount.google.com/apppasswords
(requires 2-Step Verification enabled on the Google account).

## Local development

```bash
npm install
cp .env.example .env   # fill in values
npm start
```

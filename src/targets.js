// Resolves the list of URLs this service should health-check.
//
// The original single-target config (WEBHOOK_ENDPOINT_URL / HEALTH_CHECK_METHOD)
// stays as-is and keeps alert kind "endpoint_down" unchanged, so existing alert
// history/behavior for that target is untouched.
//
// Additional targets go in EXTRA_HEALTH_CHECK_TARGETS as `name|METHOD|url` entries
// separated by `;`, e.g.:
//   healthz|GET|https://curatal-dev.openturf.dev/api/v1/admin/healthz
// Each gets its own alert kind (`endpoint_down:<name>`) so one target's status
// never masks or clears another's alert.
function parseTargets() {
  const targets = [];

  const primaryUrl = process.env.WEBHOOK_ENDPOINT_URL;
  if (primaryUrl) {
    targets.push({
      name: 'webhook',
      url: primaryUrl,
      method: (process.env.HEALTH_CHECK_METHOD || 'POST').toUpperCase(),
      alertKind: 'endpoint_down',
    });
  }

  const extra = process.env.EXTRA_HEALTH_CHECK_TARGETS;
  if (extra) {
    extra
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const [name, method, url] = entry.split('|').map((s) => (s || '').trim());
        if (!name || !method || !url) {
          console.warn('[targets] skipping malformed EXTRA_HEALTH_CHECK_TARGETS entry:', entry);
          return;
        }
        targets.push({ name, url, method: method.toUpperCase(), alertKind: `endpoint_down:${name}` });
      });
  }

  return targets;
}

module.exports = { parseTargets };

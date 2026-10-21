// This installation's own address, for the links a service puts into what it writes.
// ts-app passes it as settings.APP_URL (its ROOT_URL, ending in '/'). A caller that
// passes none gets a local default, never the hosted SaaS.
// Shared with the webhook service (webhook/index.js, webhook/services/Webhook.js): it lives
// here because docker/build-workers.sh ships only entry.js, analysis/ and webhook/.
export const DEFAULT_APP_URL = 'http://localhost:3000/';

export function appBaseUrl(appUrl) {
  if (typeof appUrl !== 'string' || !appUrl.trim()) {
    return DEFAULT_APP_URL;
  }
  const base = appUrl.trim();
  return base.endsWith('/') ? base : base + '/';
}

// `path` is relative to the app root; a leading slash is dropped so the link never
// carries a double slash.
export function appLink(appUrl, path) {
  return appBaseUrl(appUrl) + String(path || '').replace(/^\/+/, '');
}

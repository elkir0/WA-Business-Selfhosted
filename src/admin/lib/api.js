/**
 * Thin fetch wrapper for the admin API.
 *
 * - Always sends the session cookie (`credentials: 'same-origin'`).
 * - Injects the CSRF token on state-changing requests by first fetching
 *   `/admin/csrf-token` (cached per session).
 * - Parses JSON; throws an Error with the server-provided message on non-2xx.
 */

let csrfCache = null;

async function getCsrfToken() {
  if (csrfCache) return csrfCache;
  const r = await fetch('/admin/csrf-token', { credentials: 'same-origin' });
  if (!r.ok) throw new Error('Failed to fetch CSRF token.');
  const data = await r.json();
  csrfCache = data.token;
  return csrfCache;
}

async function request(method, path, body) {
  const headers = { 'Accept': 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = await getCsrfToken();
  }

  const resp = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (resp.status === 401) {
    // Session expired — bounce to login.
    window.location.assign('/admin/login?next=' + encodeURIComponent(window.location.pathname));
    return new Promise(() => {});
  }

  const text = await resp.text();
  const data = text ? safeJsonParse(text) : null;

  if (!resp.ok) {
    const msg = (data && data.error) || `HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get:    (path)        => request('GET', path),
  post:   (path, body)  => request('POST', path, body || {}),
  patch:  (path, body)  => request('PATCH', path, body || {}),
  del:    (path)        => request('DELETE', path),
};

/**
 * Pulso browser event SDK (staging/integration layer).
 * All events are opt-in and the collector must validate public site keys,
 * authorized domains, consent, payload size, and rate limits server-side.
 * No Meta access token, Hotmart Hottok or Supabase secret belongs in this file.
 */
const CLICK_KEYS = Object.freeze([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'src', 'fbclid', 'gclid', 'gbraid', 'wbraid', 'tblci',
]);
const EVENTS = new Set(['page_view', 'view_content', 'checkout_click']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDOFF = /^[A-Za-z0-9_-]{24,512}$/;

function sanitizedURL(input) {
  const u = new URL(input);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new TypeError('Use HTTPS');
  return u;
}
function readCookie(header, name) {
  const found = header.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  if (!found) return null;
  try { return decodeURIComponent(found.slice(name.length + 1)).slice(0,250); }
  catch { return null; }
}
function safeQuery(u) {
  const data = {};
  for (const key of CLICK_KEYS) {
    const value = u.searchParams.get(key);
    if (value && value.length <= 250) data[key] = value;
  }
  return data;
}

/**
 * @param {Object} config
 * @param {string} config.collectorUrl - HTTPS server endpoint, not a third-party pixel.
 * @param {string} config.publicSiteKey - per-site *public* identifier; not a secret.
 * @param {() => boolean} config.marketingAllowed - must reflect a valid consent/legal-basis decision.
 * @param {(input: string, init: Object) => Promise<Response>} [config.fetchImpl]
 * @param {() => string} [config.currentUrl]
 * @param {() => string} [config.cookieHeader]
 * @param {{getItem:Function,setItem:Function}} [config.sessionStorage]
 * @param {() => string} [config.randomUUID]
 */
export function createPulsoTracker(config) {
  const {
    collectorUrl, publicSiteKey, marketingAllowed,
    fetchImpl = (...args) => globalThis.fetch(...args),
    currentUrl = () => globalThis.location.href,
    cookieHeader = () => globalThis.document.cookie,
    sessionStorage = globalThis.sessionStorage,
    randomUUID = () => globalThis.crypto.randomUUID(),
  } = config ?? {};

  const endpoint = sanitizedURL(collectorUrl);
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost') throw new Error('Secure endpoint required');
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(publicSiteKey || '')) throw new Error('Invalid public site key');
  if (typeof marketingAllowed !== 'function') throw new Error('Consent check required');
  const key = `pulso:sid:${publicSiteKey}`;
  let handoffToken = null;

  function allowed() { return marketingAllowed() === true; }
  function sessionId() {
    // Do not create or read an advertising session prior to permission.
    if (!allowed()) return null;
    let id = sessionStorage?.getItem(key);
    if (!UUID.test(id || '')) {
      id = randomUUID();
      if (!UUID.test(id)) throw new Error('Secure UUID required');
      sessionStorage?.setItem(key, id);
    }
    return id;
  }

  async function track(eventName) {
    if (!EVENTS.has(eventName)) throw new Error('Unsupported event');
    if (!allowed()) return {sent: false, reason: 'marketing_not_allowed'};
    const url = sanitizedURL(currentUrl());
    const sid = sessionId();
    const payload = {
      site_key: publicSiteKey, public_session_id: sid,
      event_id: randomUUID(), event_name: eventName,
      // Strip URL queries, fragments, credentials; attribution fields are explicitly allowlisted.
      page_url: url.origin + url.pathname,
      click: safeQuery(url),
      browser: {
        fbp: readCookie(cookieHeader() || '', '_fbp'),
        fbc: readCookie(cookieHeader() || '', '_fbc'),
      },
    };
    const response = await fetchImpl(endpoint.href, {
      method: 'POST', mode: 'cors', credentials: 'omit',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload), keepalive: true,
    });
    if (!response.ok) return {sent: false, reason: `http_${response.status}`};
    const body = await response.json().catch(() => ({}));
    if (allowed() && typeof body.checkout_handoff_token === 'string' && HANDOFF.test(body.checkout_handoff_token)) {
      handoffToken = body.checkout_handoff_token;
    }
    return {sent: true, session_id: sid};
  }

  function checkoutHref(rawHref) {
    const url = sanitizedURL(rawHref);
    // Never decorate external destinations, never overwrite an existing checkout sck.
    if (url.hostname !== 'pay.hotmart.com' || !allowed() || !handoffToken || url.searchParams.has('sck')) {
      return rawHref;
    }
    url.searchParams.set('sck', handoffToken);
    return url.href;
  }

  function reset() {
    handoffToken = null;
    try { sessionStorage?.removeItem(key); } catch { /* storage may be disabled */ }
  }
  return Object.freeze({track, checkoutHref, reset});
}
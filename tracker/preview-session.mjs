/** Consent and event ordering for the isolated sales-page preview only.
 * No navigation, advertising pixel, checkout-open inference or buyer data.
 */
export const CONTENT_VISIBILITY_RATIO = 0.5;
export const PREVIEW_CONSENT_POLICY = 'embarque-preview-consent-v1';
const CONSENT_TTL = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const result = (sent, reason) => ({sent, reason});

export function createPreviewSession({tracker, now = () => Date.now(), randomUUID = () => globalThis.crypto.randomUUID(), onStatus = () => {}} = {}) {
  if (typeof tracker?.track !== 'function' || typeof tracker?.revokeConsent !== 'function' ||
      typeof now !== 'function' || typeof randomUUID !== 'function' || typeof onStatus !== 'function') {
    throw new TypeError('Preview tracker and clock are required');
  }
  let intent = null, active = null, visible = false, queue = Promise.resolve();
  const enqueue = task => {
    const pending = queue.then(task);
    queue = pending.catch(() => {});
    return pending;
  };
  const notify = (event, reply) => {
    // Only our fixed labels reach the page. Provider responses/IDs never do.
    try { onStatus({event, sent:reply.sent, reason:reply.reason}); } catch { /* presentation cannot change consent */ }
    return reply;
  };
  function clock() {
    const value = now();
    return Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime()) ? value : null;
  }
  function fresh(value) {
    const time = clock();
    return value !== null && time !== null && time >= value.capturedAt && time < value.capturedAt + CONSENT_TTL;
  }
  function allowed() { return active !== null && active === intent && fresh(active); }
  function consentRecord() {
    return allowed() ? {marketing:true, basis:'consent', policy_version:PREVIEW_CONSENT_POLICY, captured_at:new Date(active.capturedAt).toISOString()} : null;
  }
  async function revokeTracker(reason = 'revoked') {
    try {
      const reply = await tracker.revokeConsent();
      return notify('consent', result(reply?.sent === true, reply?.sent === true ? reason : reply?.reason === 'no_session' ? 'measurement_disabled' : 'revocation_pending'));
    } catch { return notify('consent', result(false, 'revocation_pending')); }
  }
  function stateFailure(value) {
    if (!value || value !== intent || value !== active) return result(false, 'consent_required');
    if (!fresh(value)) {
      intent = null; active = null;
      // Run after any in-flight SDK request. Reacceptance queues behind this
      // barrier, so an old response cannot survive a quick revoke/reaccept.
      enqueue(() => revokeTracker('consent_expired'));
      return notify('consent', result(false, 'consent_expired'));
    }
    return null;
  }
  function id() {
    const value = randomUUID();
    if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError('Secure UUID required');
    return value;
  }
  async function send(value, name, eventId) {
    const denied = stateFailure(value);
    if (denied) return denied;
    let reply;
    try { reply = await tracker.track(name, {eventId}); }
    catch { reply = null; }
    const stale = stateFailure(value);
    if (stale) return stale;
    return notify(name, result(reply?.sent === true, reply?.sent === true ? 'recorded' : 'collection_failed'));
  }
  async function page(value) {
    const denied = stateFailure(value);
    if (denied) return denied;
    if (value.pageSent) return result(true, 'already_recorded');
    const reply = await send(value, 'page_view', value.pageId);
    if (reply.sent) value.pageSent = true;
    return reply;
  }
  async function content(value) {
    const denied = stateFailure(value);
    if (denied) return denied;
    if (!visible) return result(false, 'content_not_visible');
    if (value.contentSent) return result(true, 'already_recorded');
    const prior = await page(value);
    if (!prior.sent) return prior;
    // Visibility may have changed while PageView was being acknowledged.
    if (!visible) return result(false, 'content_not_visible');
    const reply = await send(value, 'view_content', value.contentId);
    if (reply.sent) value.contentSent = true;
    return reply;
  }
  function accept() {
    const time = clock();
    if (time === null) return Promise.resolve(notify('consent', result(false, 'clock_unavailable')));
    if (intent && !fresh(intent)) {
      intent = null; active = null;
      enqueue(() => revokeTracker('consent_expired'));
    }
    if (!intent) {
      try { intent = {capturedAt:time, pageId:id(), contentId:id(), pageSent:false, contentSent:false, checkout:null}; }
      catch { return Promise.resolve(notify('consent', result(false, 'configuration_unavailable'))); }
    }
    const value = intent;
    return enqueue(async () => {
      if (value !== intent) return result(false, 'consent_required');
      active = value;
      const reply = await page(value);
      if (reply.sent && visible) await content(value);
      return reply;
    });
  }
  function revoke() {
    intent = null; active = null;
    return enqueue(() => revokeTracker());
  }
  function setVisible(entry = {}) {
    visible = entry.isIntersecting === true && Number.isFinite(entry.intersectionRatio) &&
      entry.intersectionRatio >= CONTENT_VISIBILITY_RATIO && entry.intersectionRatio <= 1;
    const value = intent;
    return !visible || !value ? Promise.resolve(result(false, 'content_not_visible')) : enqueue(() => content(value));
  }
  function checkout(rawURL) {
    let url;
    try { url = new URL(rawURL); } catch { return Promise.resolve(result(false, 'checkout_url_invalid')); }
    if (url.protocol !== 'https:' || url.hostname !== 'pay.hotmart.com' || url.port || url.username || url.password) {
      return Promise.resolve(result(false, 'checkout_url_invalid'));
    }
    const value = intent;
    if (!value) return Promise.resolve(result(false, 'consent_required'));
    // Retries/double-clicks while one logical click is pending reuse its ID.
    // A subsequent deliberate click after acknowledgment is a new event.
    let attempt = value.checkout;
    if (!attempt || attempt.sent || attempt.rawURL !== rawURL) {
      try { attempt = value.checkout = {rawURL, eventId:id(), sent:false}; }
      catch { return Promise.resolve(result(false, 'configuration_unavailable')); }
    }
    return enqueue(async () => {
      const denied = stateFailure(value);
      if (denied) return denied;
      const prior = await page(value);
      if (!prior.sent) return prior;
      if (visible) await content(value);
      if (attempt.sent) return result(true, 'already_recorded');
      const reply = await send(value, 'checkout_click', attempt.eventId);
      if (reply.sent) attempt.sent = true;
      // Never expose a handoff/decorated URL or infer checkout_started here.
      return reply;
    });
  }
  return Object.freeze({allowed, consentRecord, accept, deny:revoke, revoke, setVisible, checkout});
}

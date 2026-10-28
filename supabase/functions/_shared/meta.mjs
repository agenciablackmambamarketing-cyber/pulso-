/** Backend-only CAPI transport. Never log request bodies, user_data or credentials. */
const encoder = new TextEncoder();
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[0-9]{5,32}$/;
export function validateDataset(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('invalid_dataset');
  return value;
}
export function graphVersion(value) {
  // Required deployment setting: never silently use an unversioned or stale API.
  if (!/^v[2-9][0-9]\.0$/.test(value ?? '')) throw new Error('graph_version_required');
  return value;
}
export function safeResult(httpStatus, body) {
  const code = Number.isInteger(body?.error?.code) ? body.error.code : null;
  const accepted = httpStatus >= 200 && httpStatus < 300 && body?.events_received === 1 && !body?.error;
  const retryable = !accepted && (httpStatus === 429 || httpStatus >= 500 || body?.error?.is_transient === true);
  const trace = typeof body?.fbtrace_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(body.fbtrace_id) ? body.fbtrace_id : null;
  return {accepted, retryable, http_status: httpStatus, meta_error_code: code,
    error_code: accepted ? null : code === 190 ? 'meta_auth' : retryable ? 'meta_transient' : 'meta_rejected', response_id: trace};
}
export function purchasePayload(row, credential, {allowProduction = false, now = Date.now()} = {}) {
  if (row.provider !== 'meta' || row.event_name !== 'Purchase' || row.marketing_allowed !== true) throw new Error('event_not_authorized');
  if (!credential || !credential.access_token) throw new Error('credential_missing');
  const test = row.test_mode !== false;
  if (!test || credential.mode !== 'test') {
    if (!allowProduction || test || credential.mode !== 'production') throw new Error('production_disabled');
  }
  if (test && !/^[A-Za-z0-9_-]{3,128}$/.test(credential.test_event_code ?? '')) throw new Error('test_code_required');
  const time = Math.floor(Date.parse(row.event_time) / 1000);
  if (!Number.isFinite(time) || time > now / 1000 + 60 || time < now / 1000 - 6 * 86400) throw new Error('event_expired');
  const value = Number(row.value);
  if (!Number.isFinite(value) || value < 0 || !/^[A-Z]{3}$/.test(row.currency ?? '') || !/^[A-Za-z0-9_-]{16,128}$/.test(row.event_id ?? '')) throw new Error('invalid_event');
  const user_data = {};
  for (const [source, target] of Object.entries({email_sha256:'em',phone_sha256:'ph',first_name_sha256:'fn',last_name_sha256:'ln',city_sha256:'ct',state_sha256:'st',postcode_sha256:'zp',country_sha256:'country',external_id_sha256:'external_id'})) {
    if (row[source] != null) {
      if (!HASH.test(row[source])) throw new Error('invalid_hash');
      user_data[target] = [row[source]];
    }
  }
  // These Meta fields are not hashed. They originate from the consented page, not the webhook IP.
  for (const [source,target] of Object.entries({fbp:'fbp',fbc:'fbc',client_ip:'client_ip_address',client_user_agent:'client_user_agent'})) {
    if (typeof row[source] === 'string' && row[source]) user_data[target] = row[source];
  }
  if (!Object.keys(user_data).length) throw new Error('matching_missing');
  const event = {event_name:'Purchase',event_id:row.event_id,event_time:time,action_source:'website',user_data,
    custom_data:{value,currency:row.currency}};
  if (row.event_source_url) {
    const url = new URL(row.event_source_url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_source');
    event.event_source_url = url.origin + url.pathname;
  }
  if (row.product_id) {
    event.custom_data.content_ids = [String(row.product_id)];
    event.custom_data.content_type = 'product';
    event.custom_data.contents = [{id:String(row.product_id),quantity:1,item_price:value}];
  }
  const payload = {data:[event]};
  if (test) payload.test_event_code = credential.test_event_code;
  return payload;
}
export async function sendPurchase(row, credential, config = {}) {
  const {fetchImpl = fetch, version, allowProduction = false, now = Date.now()} = config;
  const dataset = validateDataset(credential.dataset_id);
  const payload = purchasePayload(row, credential, {allowProduction, now});
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${graphVersion(version)}/${dataset}/events`, {
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential.access_token}`},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(10000),redirect:'error',
    });
    const body = await response.json().catch(() => ({}));
    return safeResult(response.status, body);
  } catch {
    return {accepted:false,retryable:true,http_status:0,meta_error_code:null,error_code:'meta_network',response_id:null};
  }
}
export async function verifyDataset(datasetId, token, {fetchImpl = fetch, version} = {}) {
  validateDataset(datasetId);
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192 || /[\s\r\n]/.test(token)) throw new Error('invalid_token');
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${graphVersion(version)}/${datasetId}?fields=id`, {
      headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000),redirect:'error',
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.id === datasetId && !body.error) return {ok:true};
    return {ok:false,http_status:response.status,meta_error_code:Number.isInteger(body?.error?.code) ? body.error.code : null};
  } catch { return {ok:false,http_status:0,meta_error_code:null}; }
}
function b64(bytes) {return btoa(String.fromCharCode(...bytes));}
function unb64(text) {return Uint8Array.from(atob(text), c => c.charCodeAt(0));}
async function aesKey(base64Key) {
  const bytes = unb64(base64Key ?? '');
  if (bytes.length !== 32) throw new Error('credential_key_required');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']);
}
/** AAD binds encrypted credentials to both workspace and dataset. Key stays in Edge secrets. */
export async function sealCredential(value, workspaceId, datasetId, base64Key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`${workspaceId}:${datasetId}`)},await aesKey(base64Key),encoder.encode(JSON.stringify(value)));
  return JSON.stringify({v:1,iv:b64(iv),data:b64(new Uint8Array(ciphertext))});
}
export async function openCredential(sealed, workspaceId, datasetId, base64Key) {
  const box = JSON.parse(sealed);
  if (box.v !== 1) throw new Error('credential_key_version');
  const bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(box.iv),additionalData:encoder.encode(`${workspaceId}:${datasetId}`)},await aesKey(base64Key),unb64(box.data));
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (value.dataset_id !== datasetId) throw new Error('credential_binding');
  return value;
}
export async function secretMatches(expected, supplied) {
  if (!expected || expected.length < 32 || !supplied) return false;
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(expected)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(supplied)));
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
/** Future adapters must explicitly fail closed until individually implemented and authorized. */
export function conversionProvider(name) {
  if (name !== 'meta') throw new Error('provider_not_implemented');
  return Object.freeze({name:'meta',send:sendPurchase});
}

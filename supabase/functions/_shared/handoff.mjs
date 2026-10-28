/** Opaque HMAC handoff, 30 alphanumeric chars (Hotmart's documented limit).
 * Nonce has 72 random bits; MAC has 96 bits. Expiry/site/tenant live only in
 * private.tracking_handoffs. A valid MAC alone never authorizes attribution.
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const HANDOFF_PATTERN = /^[0-9A-Za-z]{30}$/;
function base62(bytes, width) {
  let n = 0n; for (const byte of bytes) n = (n << 8n) + BigInt(byte);
  let out = ''; do { out = ALPHABET[Number(n % 62n)] + out; n /= 62n; } while (n);
  if (out.length > width) throw new TypeError('Invalid handoff width');
  return out.padStart(width, '0');
}
async function signature(nonce, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new TypeError('Handoff key must have at least 32 characters');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`pulso-handoff-v1:${nonce}`)));
  return base62(signed.slice(0,12),17);
}
export async function mintHandoff(secret) {
  const nonce = base62(crypto.getRandomValues(new Uint8Array(9)),13);
  return nonce + await signature(nonce,secret);
}
export async function verifyHandoff(token,secret) {
  if (!HANDOFF_PATTERN.test(token || '')) return false;
  const expected=await signature(token.slice(0,13),secret); let difference=0;
  for(let i=0;i<17;i++)difference |= expected.charCodeAt(i)^token.charCodeAt(i+13);
  return difference===0;
}
export async function sha256(value) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  return [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

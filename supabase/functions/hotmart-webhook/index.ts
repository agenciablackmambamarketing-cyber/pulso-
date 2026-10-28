import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const jsonHeaders = { "Content-Type": "application/json" };
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const hottok = request.headers.get("x-hotmart-hottok");
  if (!hottok || hottok.length < 12) return json({ error: "Unauthorized" }, 401);
  const len = Number(request.headers.get("content-length") || "0");
  if (len > 128_000) return json({ error: "Payload too large" }, 413);
  let event: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 128_000) return json({ error: "Payload too large" }, 413);
    event = JSON.parse(raw);
    if (!event || Array.isArray(event) || typeof event !== "object") throw new Error("bad body");
  } catch {
    return json({ error: "Malformed JSON" }, 400);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const modernKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const modernKey = modernKeys ? JSON.parse(modernKeys)["default"] : undefined;
  const key = modernKey || legacyKey;
  if (!url || !key) return json({ error: "Server not configured" }, 503);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }});
  const { data, error } = await client.rpc("ingest_hotmart_event", {p_hottok: hottok,p_payload: event});
  if (error) {
    // The raw webhook and its token are never logged.
    const badInput = /Invalid Hotmart event|Invalid event timestamp|Invalid money amount/.test(error.message);
    const denied = /Unauthorized Hotmart source/.test(error.message);
    console.error("hotmart-ingest failed", { code: error.code, category: badInput ? "bad_input" : denied ? "denied" : "database" });
    return json({ error: badInput ? "Invalid event" : denied ? "Unauthorized" : "Ingestion failed" },badInput ? 400 : denied ? 401 : 503);
  }
  return json(data ?? {ok:true});
});
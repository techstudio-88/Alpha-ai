import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function probe(url, headers = {}, timeoutMs = 2500) {
  if (!url) return { status: "not_configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
    let body = null;
    try { body = await response.json(); } catch {}
    return {
      status: response.ok && body?.ok !== false ? "ok" : "unhealthy",
      httpStatus: response.status,
      ...(body?.service ? { service: String(body.service).slice(0, 80) } : {}),
    };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

async function checkSupabase() {
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return { status: "not_configured" };
  return probe(new URL("/rest/v1/", base).toString(), {
    apikey: key,
    Authorization: `Bearer ${key}`,
  });
}

async function checkWorker() {
  const base = process.env.MEDIA_WORKER_URL || process.env.WORKER_URL;
  if (!base) return { status: "not_configured" };
  const url = base.replace(/\/+$/, "") + "/health";
  const result = await probe(url, {}, 3000);
  // Never expose worker response payloads, URLs, or credentials from this public endpoint.
  return result;
}

export async function GET() {
  const started = Date.now();
  const [supabase, mediaWorker] = await Promise.all([checkSupabase(), checkWorker()]);
  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY_1 ||
    process.env.GEMINI_API_KEY_2 ||
    process.env.GEMINI_API_KEY_3 ||
    process.env.GEMINI_API_KEY_4 ||
    process.env.GEMINI_API_KEY_5
  );
  const requiredHealthy = supabase.status === "ok";
  const workerRequired = Boolean(process.env.MEDIA_WORKER_URL || process.env.WORKER_URL);
  const workerHealthy = !workerRequired || mediaWorker.status === "ok";
  const ok = requiredHealthy && workerHealthy;
  return NextResponse.json({
    ok,
    service: "alpha.ai",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    dependencies: {
      supabase,
      mediaWorker,
      gemini: { status: geminiConfigured ? "configured_unverified" : "not_configured" },
    },
  }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

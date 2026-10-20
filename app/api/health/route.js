import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));

async function checkSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { status: "not_configured" };
  try {
    const result = await Promise.race([
      fetch(new URL("/rest/v1/", url), { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }).then((response) => ({ status: response.ok ? "ok" : "unhealthy", httpStatus: response.status })),
      timeout(2500),
    ]);
    if (result === "timeout") return { status: "timeout" };
    return result;
  } catch {
    return { status: "unreachable" };
  }
}

export async function GET() {
  const started = Date.now();
  const supabase = await checkSupabase();
  const workerConfigured = Boolean(process.env.MEDIA_WORKER_URL || process.env.WORKER_URL);
  const dependenciesHealthy = supabase.status === "ok";
  return NextResponse.json({
    ok: dependenciesHealthy,
    service: "alpha.ai",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    dependencies: {
      supabase,
      mediaWorker: { status: workerConfigured ? "configured_unverified" : "not_configured" },
    },
  }, { status: dependenciesHealthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

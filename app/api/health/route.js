import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const timeoutSignal = () => AbortSignal.timeout(3500);

async function checkSupabase() {
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!base || !key) return { status: "not_configured" };
  try {
    const response = await fetch(`${base}/auth/v1/health`, { headers: { apikey: key }, cache: "no-store", signal: timeoutSignal() });
    return { status: response.ok ? "ok" : "error", httpStatus: response.status };
  } catch { return { status: "unreachable" }; }
}

async function checkWorker() {
  const base = (process.env.MEDIA_WORKER_URL || "").replace(/\/$/, "");
  if (!base) return { status: "not_configured" };
  try {
    const response = await fetch(`${base}/health`, { headers: { "cache-control": "no-cache" }, cache: "no-store", signal: timeoutSignal() });
    return { status: response.ok ? "ok" : "error", httpStatus: response.status };
  } catch { return { status: "unreachable" }; }
}

export async function GET() {
  const [supabase, worker] = await Promise.all([checkSupabase(), checkWorker()]);
  const ok = ["ok", "not_configured"].includes(supabase.status) && ["ok", "not_configured"].includes(worker.status);
  return NextResponse.json({ ok, status: ok && supabase.status === "ok" && worker.status === "ok" ? "ok" : "degraded", service: "alpha.ai", timestamp: new Date().toISOString(), dependencies: { supabase, worker } }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

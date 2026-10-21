import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { enforceApiRateLimit } from "../../../../../lib/workflow-server";

export const runtime = "nodejs";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const publicDb = () => createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const adminDb = () => createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const jsonError = (message, status, errorId = randomUUID()) => Response.json({ error: message, errorId }, { status, headers: { "Cache-Control": "no-store" } });
async function authenticate(request) {
  if (!supabaseUrl || !anonKey || !serviceKey) throw Object.assign(new Error("Billing is not configured."), { status: 503 });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("Sign in to continue."), { status: 401 });
  const { data, error } = await publicDb().auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error("Your session expired. Sign in again."), { status: 401 });
  return { user: data.user, token, admin: adminDb() };
}

export async function POST(request) {
  try {
    const { user, admin } = await authenticate(request);
    const body = await request.json().catch(() => null);
    const orderId = String(body?.order_id || "");
    const workspaceId = String(body?.workspace_id || "");
    const utr = String(body?.utr || "").trim();
    if (!orderId || !workspaceId || !/^\d{12}$/.test(utr)) return jsonError("Enter the order, workspace and a valid 12-digit UTR.", 400);
    await enforceApiRateLimit(admin, "user:" + user.id, "/api/billing/upi/submit", 8, 60, request.headers.get("x-real-ip") || null);
    const { data: member, error: memberError } = await admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (memberError) throw memberError;
    if (!member) return jsonError("Workspace access denied.", 403);
    const { data, error } = await admin.rpc("submit_upi_utr", { p_order: orderId, p_user: user.id, p_workspace: workspaceId, p_utr: utr });
    if (error) throw error;
    if (!data?.ok) {
      const errors = { bad_utr: ["Enter a valid 12-digit UTR.", 400], utr_used: ["This UTR has already been submitted.", 409], not_allowed: ["This order cannot accept a UTR. It may be expired or already reviewed.", 409] };
      const [message, status] = errors[data?.error] || ["Unable to submit this UTR.", 409];
      return jsonError(message, status);
    }
    return Response.json({ ok: true, status: "submitted" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error?.status ? error.message : "Unable to submit payment details. Try again.", error?.status || 500); }
}

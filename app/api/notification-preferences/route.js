import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { enforceApiRateLimit } from "../../../lib/workflow-server";

export const runtime = "nodejs";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const fail = (message, status) => Response.json({ error: message, errorId: randomUUID() }, { status, headers: { "Cache-Control": "no-store" } });
async function context(request) {
  if (!url || !anon || !secret) throw Object.assign(new Error("Notification preferences are not configured."), { status: 503 });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("Sign in to continue."), { status: 401 });
  const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await pub.auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error("Your session expired. Sign in again."), { status: 401 });
  return { user: data.user, admin: createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) };
}
const FIELDS = ["job_completed_email", "job_failed_email", "billing_email", "product_updates_email"];
export async function GET(request) {
  try {
    const { user, admin } = await context(request);
    const workspaceId = new URL(request.url).searchParams.get("workspace_id");
    if (!workspaceId) return fail("workspace_id is required.", 400);
    await enforceApiRateLimit(admin, "user:" + user.id, "/api/notification-preferences", 60, 60, request.headers.get("x-real-ip") || null);
    const { data: member, error: memberError } = await admin.from("workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (memberError) throw memberError;
    if (!member) return fail("Workspace access denied.", 403);
    const { data, error } = await admin.from("user_notification_preferences").select(FIELDS.join(",")).eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return Response.json({ preferences: data || { job_completed_email: true, job_failed_email: true, billing_email: true, product_updates_email: false } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error?.status ? error.message : "Unable to load notification preferences.", error?.status || 500); }
}
export async function PUT(request) {
  try {
    const { user, admin } = await context(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Send a valid JSON request.", 400);
    const workspaceId = String(body.workspace_id || "");
    if (!workspaceId) return fail("workspace_id is required.", 400);
    await enforceApiRateLimit(admin, "user:" + user.id, "/api/notification-preferences", 30, 60, request.headers.get("x-real-ip") || null);
    const { data: member, error: memberError } = await admin.from("workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (memberError) throw memberError;
    if (!member) return fail("Workspace access denied.", 403);
    const patch = { workspace_id: workspaceId, user_id: user.id, updated_at: new Date().toISOString() };
    for (const field of FIELDS) if (typeof body[field] === "boolean") patch[field] = body[field];
    if (Object.keys(patch).length === 3) return fail("Provide at least one notification preference.", 400);
    const { data, error } = await admin.from("user_notification_preferences").upsert(patch, { onConflict: "workspace_id,user_id" }).select(FIELDS.join(",")).single();
    if (error) throw error;
    return Response.json({ ok: true, preferences: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error?.status ? error.message : "Unable to save notification preferences.", error?.status || 500); }
}

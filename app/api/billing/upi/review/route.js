import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { enforceApiRateLimit } from "../../../../../lib/workflow-server";

export const runtime = "nodejs";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const errorResponse = (message, status, errorId = randomUUID()) => Response.json({ error: message, errorId }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request) {
  try {
    if (!url || !anon || !secret) return errorResponse("Admin billing is not configured.", 503);
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return errorResponse("Authentication required.", 401);
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await client.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return errorResponse("Your session expired. Sign in again.", 401);
    let authTime = 0;
    try { authTime = Number(JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8")).auth_time) || 0; } catch {}
    if (!authTime || Date.now() / 1000 - authTime > 900) return errorResponse("Please sign in again before reviewing payments.", 401);
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = String(user.email || "").toLowerCase();
    const allow = (process.env.ALPHA_CONTROL_ADMIN_EMAILS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
    const { data: member, error: memberError } = await admin.from("control_center_members").select("role,active").eq("email", email).eq("active", true).maybeSingle();
    if (memberError) throw memberError;
    if (!allow.includes(email) && !member) return errorResponse("Admin access denied.", 404);
    if (member && !["owner", "admin"].includes(member.role) && !allow.includes(email)) return errorResponse("Payment review permission denied.", 403);
    await enforceApiRateLimit(admin, "user:" + user.id, "/api/billing/upi/review", 20, 60, request.headers.get("x-real-ip") || null);
    const body = await request.json().catch(() => null);
    const orderId = String(body?.order_id || "");
    const action = String(body?.action || "");
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;
    if (!orderId || !["approve", "reject"].includes(action)) return errorResponse("Provide an order and approve/reject action.", 400);
    if (action === "reject") {
      const { data: order, error } = await admin.from("upi_payment_orders").select("id,workspace_id,status").eq("id", orderId).maybeSingle();
      if (error) throw error;
      if (!order) return errorResponse("Payment order not found.", 404);
      if (order.status !== "submitted") return errorResponse("Only submitted payments can be rejected.", 409);
      const { data: changed, error: updateError } = await admin.from("upi_payment_orders").update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: email, review_note: note }).eq("id", orderId).eq("status", "submitted").select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!changed) return errorResponse("The order was reviewed by another admin. Refresh and try again.", 409);
      const { error: auditError } = await admin.from("audit_logs").insert({ user_id: user.id, workspace_id: order.workspace_id, action: "upi_payment_rejected", entity_type: "upi_payment_order", entity_id: orderId, metadata: { note } });
      if (auditError) throw auditError;
      return Response.json({ ok: true, status: "rejected" }, { headers: { "Cache-Control": "no-store" } });
    }
    const { data, error } = await admin.rpc("approve_upi_order", { p_order: orderId, p_admin: email, p_note: note });
    if (error) throw error;
    if (!data?.ok) {
      const statuses = { not_found: ["Payment order not found.", 404], not_submitted: ["Only submitted payments can be approved.", 409] };
      const [message, status] = statuses[data?.error] || ["Payment approval was not completed.", 409];
      return errorResponse(message, status);
    }
    const { data: order } = await admin.from("upi_payment_orders").select("workspace_id").eq("id", orderId).maybeSingle();
    const { error: auditError } = await admin.from("audit_logs").insert({ user_id: user.id, workspace_id: order?.workspace_id || null, action: data.already ? "upi_payment_approval_replayed" : "upi_payment_approved", entity_type: "upi_payment_order", entity_id: orderId, metadata: { note, already: Boolean(data.already) } });
    if (auditError) throw auditError;
    return Response.json({ ok: true, already: Boolean(data.already), status: "approved" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error?.status ? error.message : "Payment review failed. Try again or contact support.", error?.status || 500);
  }
}

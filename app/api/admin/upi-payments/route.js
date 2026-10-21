import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const ADMIN_EMAIL = "techstudio7808@gmail.com";
const fail = (message, status) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

function clients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !anon || !service) return null;
  return {
    auth: createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }),
    db: createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

async function adminFromRequest(request, c) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await c.auth.auth.getUser(token);
  if (error || !data?.user || String(data.user.email || "").toLowerCase() !== ADMIN_EMAIL) return null;
  return data.user;
}

export async function GET(request) {
  const c = clients();
  if (!c) return fail("Payment review is unavailable. Error ID PAY-ADMIN-CONFIG.", 503);
  const admin = await adminFromRequest(request, c);
  if (!admin) return fail("Admin access required.", 403);
  const { data, error } = await c.db.from("upi_payment_orders")
    .select("id,reference,user_id,workspace_id,plan,billing_interval,amount_paise,status,created_at,submitted_at,expires_at")
    .in("status", ["pending", "submitted"])
    .order("created_at", { ascending: true }).limit(100);
  if (error) return fail("Could not load payment orders. Error ID PAY-ADMIN-LIST.", 500);
  return NextResponse.json({ orders: data || [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const c = clients();
  if (!c) return fail("Payment review is unavailable. Error ID PAY-ADMIN-CONFIG.", 503);
  const admin = await adminFromRequest(request, c);
  if (!admin) return fail("Admin access required.", 403);
  let body;
  try { body = await request.json(); } catch { return fail("Invalid review request.", 400); }
  const orderId = String(body?.orderId || "");
  const action = body?.action;
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !["approve", "reject"].includes(action)) return fail("Invalid order or action.", 400);
  const { data, error } = await c.db.rpc("review_upi_payment_order", {
    p_order_id: orderId, p_action: action, p_admin_email: admin.email, p_review_note: note,
  });
  if (error) {
    const message = error.message || "";
    if (message.includes("PAYMENT_ORDER_NOT_FOUND")) return fail("Order not found.", 404);
    if (message.includes("ORDER_EXPIRED")) return fail("This order has expired. Ask the customer to create a new order.", 409);
    if (message.includes("ORDER_NOT_REVIEWABLE") || message.includes("ORDER_ALREADY_APPROVED")) return fail("This order has already been processed.", 409);
    return fail("Could not process this order. Error ID PAY-ADMIN-REVIEW.", 500);
  }
  return NextResponse.json({ result: data }, { headers: { "Cache-Control": "no-store" } });
}

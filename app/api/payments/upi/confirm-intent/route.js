import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
function error(message, status) { return NextResponse.json({ error: message }, { status }); }
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
export async function POST(request) {
  const c = clients();
  if (!c) return error("Payment verification is temporarily unavailable. Please contact support with error ID PAY-CONFIG-04.", 503);
  const token = request.headers.get("authorization")?.replace(/^Bearer\\s+/i, "");
  if (!token) return error("Sign in before updating your payment order.", 401);
  const { data, error: authError } = await c.auth.auth.getUser(token);
  if (authError || !data?.user) return error("Your session expired. Please sign in again.", 401);
  let body;
  try { body = await request.json(); } catch { return error("Invalid order request.", 400); }
  const orderId = String(body?.orderId || "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return error("Invalid order.", 400);
  const { data: order, error: readError } = await c.db.from("upi_payment_orders")
    .select("id,user_id,status,expires_at").eq("id", orderId).eq("user_id", data.user.id).maybeSingle();
  if (readError || !order) return error("Order not found for this account.", 404);
  if (order.status !== "pending") return error("This order has already been submitted or processed.", 409);
  if (!order.expires_at || new Date(order.expires_at).getTime() < Date.now()) {
    await c.db.from("upi_payment_orders").update({ status: "expired" }).eq("id", order.id).eq("status", "pending");
    return error("This order has expired. Create a new order to pay.", 410);
  }
  const { data: updated, error: updateError } = await c.db.from("upi_payment_orders")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", order.id).eq("user_id", data.user.id).eq("status", "pending")
    .select("id,status,submitted_at").maybeSingle();
  if (updateError || !updated) return error("Could not update this order. Refresh and try again.", 409);
  return NextResponse.json({
    order: updated,
    message: "Payment check requested. The plan remains inactive until the payment is verified.",
  }, { headers: { "Cache-Control": "no-store" } });
}

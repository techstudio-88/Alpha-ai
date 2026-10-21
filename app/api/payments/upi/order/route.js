import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const PLAN_PRICES = {
  pro: {
    monthly: Number(process.env.UPI_PRICE_PRO_MONTHLY_PAISE || 49900),
    yearly: Number(process.env.UPI_PRICE_PRO_YEARLY_PAISE || 499900),
  },
  studio: {
    monthly: Number(process.env.UPI_PRICE_STUDIO_MONTHLY_PAISE || 149900),
    yearly: Number(process.env.UPI_PRICE_STUDIO_YEARLY_PAISE || 1499900),
  },
};
const VPA = process.env.UPI_VPA || process.env.ALPHA_UPI_VPA || "8859985492@axl";
const PAYEE_NAME = process.env.UPI_PAYEE_NAME || "Alpha.ai";

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
function error(message, status) { return NextResponse.json({ error: message }, { status }); }

export async function POST(request) {
  const c = clients();
  if (!c) return error("Checkout is temporarily unavailable. Please contact support with error ID PAY-CONFIG-01.", 503);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return error("Sign in before creating a payment order.", 401);
  const { data: authData, error: authError } = await c.auth.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) return error("Your session expired. Please sign in again.", 401);

  let body;
  try { body = await request.json(); } catch { return error("Invalid order request.", 400); }
  const plan = body?.plan;
  const interval = body?.billingInterval === "yearly" ? "yearly" : "monthly";
  const amountPaise = PLAN_PRICES[plan]?.[interval];
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) return error("Choose a valid paid plan.", 400);
  if (!/^[^\s@]+@[^\s@]+$/.test(VPA)) return error("The UPI payment address is not configured correctly.", 503);

  const { data: workspaces, error: workspaceError } = await c.db
    .from("workspaces").select("id").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(1);
  if (workspaceError) return error("Could not prepare your order. Please try again with error ID PAY-ORDER-02.", 500);
  if (!workspaces?.length) return error("Create or open your Alpha.ai workspace before purchasing.", 409);

  const id = randomUUID();
  const reference = "ALPHA-" + randomBytes(5).toString("hex").toUpperCase();
  const { error: insertError } = await c.db.from("upi_payment_orders").insert({
    id, workspace_id: workspaces[0].id, user_id: user.id, plan, billing_interval: interval,
    amount_paise: amountPaise, reference, status: "pending",
  });
  if (insertError) return error("Could not save the order. Please try again with error ID PAY-ORDER-03.", 500);

  const amount = (amountPaise / 100).toFixed(2);
  const params = new URLSearchParams({
    pa: VPA, pn: PAYEE_NAME, am: amount, cu: "INR",
    tn: "Alpha.ai " + plan.toUpperCase() + " " + reference,
    tr: reference,
  });
  return NextResponse.json({
    order: { id, reference, plan, billingInterval: interval, amount: amountPaise / 100, amountPaise, status: "pending", upiUri: "upi://pay?" + params.toString() },
  }, { headers: { "Cache-Control": "no-store" } });
}

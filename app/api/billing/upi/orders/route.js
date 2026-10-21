import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { enforceApiRateLimit } from "../../../../lib/workflow-server";

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

const PLAN_KEYS = new Set(["starter", "creator", "pro", "studio"]);
function priceFor(plan, interval) {
  const suffix = interval === "yearly" ? "YEARLY" : "MONTHLY";
  const raw = process.env[`UPI_PRICE_${plan.toUpperCase()}_${suffix}_PAISE`];
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return amount;
}
export async function POST(request) {
  try {
    const { user, admin } = await authenticate(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Send a valid JSON request.", 400);
    const workspaceId = String(body.workspace_id || "");
    const plan = String(body.plan || "").toLowerCase();
    const interval = String(body.billing_interval || "monthly").toLowerCase();
    if (!workspaceId || !PLAN_KEYS.has(plan) || !["monthly", "yearly"].includes(interval)) return jsonError("Choose a valid workspace, plan and billing interval.", 400);
    const { data: workspace, error: workspaceError } = await admin.from("workspaces").select("id,owner_id,name").eq("id", workspaceId).maybeSingle();
    if (workspaceError) throw workspaceError;
    if (!workspace || workspace.owner_id !== user.id) return jsonError("Only the workspace owner can create a billing order.", 403);
    await enforceApiRateLimit(admin, "user:" + user.id, "/api/billing/upi/orders", 8, 60, request.headers.get("x-real-ip") || null);
    const amountPaise = priceFor(plan, interval);
    const vpa = String(process.env.UPI_VPA || "").trim();
    if (!amountPaise || !vpa) return jsonError("UPI checkout is not configured for this plan yet.", 503);
    const id = randomUUID();
    const reference = "ALPHA-" + id.replace(/-/g, "").slice(0, 16).toUpperCase();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data: order, error } = await admin.from("upi_payment_orders").insert({
      id, workspace_id: workspaceId, user_id: user.id, plan, billing_interval: interval,
      amount_paise: amountPaise, reference, status: "pending", expires_at: expiresAt
    }).select("id,plan,billing_interval,amount_paise,reference,status,expires_at,created_at").single();
    if (error) throw error;
    const payee = String(process.env.UPI_PAYEE_NAME || "Alpha.ai").slice(0, 80);
    const upi = new URLSearchParams({ pa: vpa, pn: payee, am: (amountPaise / 100).toFixed(2), cu: "INR", tn: `Alpha.ai ${plan} ${interval}`, tr: reference });
    return Response.json({ order, upi_uri: "upi://pay?" + upi.toString() }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error?.status ? error.message : "Unable to create a payment order. Try again.", error?.status || 500); }
}

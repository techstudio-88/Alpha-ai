import { randomBytes } from "node:crypto";
import { authorizeWorkflow, checked, problem, workflowError } from "../../../../../lib/workflow-server";
import { planAmount, upiLink } from "../../../../../lib/plans.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { workspaceId, plan, interval = "monthly" } = await request.json().catch(() => ({}));
    const { admin, user } = await authorizeWorkflow(request, workspaceId);
    const amount = planAmount(plan, interval);
    if (!amount) throw problem("Choose a valid plan and billing interval.");

    const vpa = process.env.UPI_VPA;
    const name = process.env.UPI_PAYEE_NAME || "Alpha.ai";
    if (!vpa) throw problem("Payments are not configured yet.", 503);

    const now = new Date().toISOString();
    const openOrders = checked(await admin
      .from("upi_payment_orders")
      .select("id")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "submitted"])
      .gt("expires_at", now));
    if ((openOrders || []).length >= 3) {
      throw problem("Finish or wait for your open payments first.", 429);
    }

    const reference = "ALPHA" + randomBytes(6).toString("hex").toUpperCase();
    const order = checked(await admin
      .from("upi_payment_orders")
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        plan,
        billing_interval: interval,
        amount_paise: amount,
        reference,
      })
      .select("id,reference,amount_paise,expires_at")
      .single());

    return Response.json({
      order,
      upi: upiLink({ vpa, name, amountPaise: amount, reference }),
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return workflowError(error);
  }
}

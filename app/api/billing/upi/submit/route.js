import { authorizeWorkflow, checked, problem, workflowError } from "../../../../../lib/workflow-server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { workspaceId, orderId, utr } = await request.json().catch(() => ({}));
    const { admin, user } = await authorizeWorkflow(request, workspaceId);
    if (!orderId || typeof orderId !== "string") throw problem("Choose a valid payment order.");

    const clean = String(utr || "").trim();
    if (!/^\d{12}$/.test(clean)) {
      throw problem("Enter the 12-digit UPI transaction ID (UTR) from your payment app.");
    }

    const order = checked(await admin
      .from("upi_payment_orders")
      .select("id,status,user_id,workspace_id,expires_at")
      .eq("id", orderId)
      .eq("workspace_id", workspaceId)
      .maybeSingle());

    if (!order || order.user_id !== user.id) throw problem("Order not found.", 404);
    if (new Date(order.expires_at).getTime() <= Date.now()) {
      throw problem("This payment order has expired. Create a new order.", 409);
    }
    if (!["pending", "submitted"].includes(order.status)) {
      throw problem("This order is already closed.", 409);
    }

    const { error } = await admin
      .from("upi_payment_orders")
      .update({
        utr: clean,
        status: "submitted",
        submitted_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId);

    if (error?.code === "23505") throw problem("This transaction ID was already used.", 409);
    if (error) throw error;

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return workflowError(error);
  }
}

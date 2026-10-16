export function nextPendingPartStatus(currentStatus, action) {
  if (!["approve", "reject"].includes(action)) {
    throw Object.assign(new Error("Choose approve or reject."), {status:400});
  }
  const target = action === "approve" ? "approved" : "declined";
  if (currentStatus === target) return target;
  if (currentStatus !== "pending") {
    throw Object.assign(new Error("This pending part has already been decided."), {status:409});
  }
  return target;
}

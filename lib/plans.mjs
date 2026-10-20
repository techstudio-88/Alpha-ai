// Prices in paise (INR). The server is the only source of plan prices.
export const PLANS = Object.freeze({
  pro: { label: "Creator", monthly: 79900, yearly: 79900 * 10 },
  studio: { label: "Studio", monthly: 149900, yearly: 149900 * 10 },
});

export function planAmount(plan, interval = "monthly") {
  const selected = PLANS[plan];
  if (!selected || !["monthly", "yearly"].includes(interval)) return null;
  return interval === "yearly" ? selected.yearly : selected.monthly;
}

export function upiLink({ vpa, name, amountPaise, reference }) {
  if (!vpa || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || !reference) {
    throw new TypeError("Valid UPI payee, amount, and reference are required.");
  }
  const params = new URLSearchParams({
    pa: vpa,
    pn: name || "Alpha.ai",
    am: (amountPaise / 100).toFixed(2),
    cu: "INR",
    tr: reference,
    tn: reference,
  });
  return "upi://pay?" + params.toString();
}

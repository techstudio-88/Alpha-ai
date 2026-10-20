import test from "node:test";
import assert from "node:assert/strict";
import { planAmount, upiLink } from "../lib/plans.mjs";

test("planAmount returns server-owned monthly and yearly INR amounts in paise", () => {
  assert.equal(planAmount("pro", "monthly"), 79900);
  assert.equal(planAmount("pro", "yearly"), 799000);
  assert.equal(planAmount("studio", "monthly"), 149900);
  assert.equal(planAmount("studio", "yearly"), 1499000);
});

test("planAmount rejects unknown plans and intervals", () => {
  assert.equal(planAmount("free", "monthly"), null);
  assert.equal(planAmount("pro", "quarterly"), null);
});

test("upiLink encodes a deterministic INR payment request", () => {
  const url = upiLink({
    vpa: "merchant@example",
    name: "Alpha.ai",
    amountPaise: 79900,
    reference: "ALPHAABC123",
  });
  assert.ok(url.startsWith("upi://pay?"));
  const params = new URLSearchParams(url.slice("upi://pay?".length));
  assert.equal(params.get("pa"), "merchant@example");
  assert.equal(params.get("pn"), "Alpha.ai");
  assert.equal(params.get("am"), "799.00");
  assert.equal(params.get("cu"), "INR");
  assert.equal(params.get("tr"), "ALPHAABC123");
  assert.equal(params.get("tn"), "ALPHAABC123");
});

test("upiLink rejects invalid amounts and missing payment details", () => {
  assert.throws(() => upiLink({ vpa: "merchant@example", amountPaise: 0, reference: "R" }), TypeError);
  assert.throws(() => upiLink({ vpa: "merchant@example", amountPaise: 100, reference: "" }), TypeError);
});

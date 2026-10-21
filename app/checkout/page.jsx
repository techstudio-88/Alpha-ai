"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";

const PLANS = {
  creator: { key: "creator", dbPlan: "pro", name: "Creator", monthly: 499, annual: 4999, minutes: "120 source minutes/month (planned)", features: ["One creator workspace", "Saved caption styles", "Priority processing"] },
  studio: { key: "studio", dbPlan: "studio", name: "Studio", monthly: 1499, annual: 14999, minutes: "600 source minutes/month (planned)", features: ["Team workspaces", "Shared brand presets", "Team support"] },
};
const VPA = "8859985492@axl";
const money = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

function CheckoutContent() {
  const search = useSearchParams();
  const planKey = (search.get("plan") || "creator").toLowerCase();
  const billing = search.get("billing") === "annual" ? "yearly" : "monthly";
  const plan = PLANS[planKey] || PLANS.creator;
  const amount = billing === "yearly" ? plan.annual : plan.monthly;
  const [session, setSession] = useState(null);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    supabase?.auth.getSession().then(({ data }) => { if (active) setSession(data?.session || null); });
    const { data } = supabase?.auth.onAuthStateChange((_event, next) => setSession(next)) || { data: null };
    return () => { active = false; data?.subscription?.unsubscribe(); };
  }, []);

  const upiUri = order?.upiUri || "";
  const payeeVpa = order?.vpa || VPA;
  const qrUrl = useMemo(() => upiUri ? "https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&format=png&data=" + encodeURIComponent(upiUri) : "", [upiUri]);

  async function createOrder() {
    if (!session?.access_token) { setError("Please sign in to create a secure order. Your order will be tied to your Alpha.ai account."); return; }
    setLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/payments/upi/order", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ plan: plan.dbPlan, billingInterval: billing }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create your order.");
      setOrder(body.order);
    } catch (e) { setError(e.message || "Could not create your order. Please try again."); }
    finally { setLoading(false); }
  }

  async function confirmPaymentIntent() {
    if (!session?.access_token || !order?.id) return;
    setSubmitting(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/payments/upi/confirm-intent", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ orderId: order.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not update your order.");
      setOrder((current) => ({ ...current, status: "submitted" }));
      setNotice("Thanks. Your order is queued for payment verification. Your plan will activate after the payment is confirmed in our payment records.");
    } catch (e) { setError(e.message || "Could not update your order."); }
    finally { setSubmitting(false); }
  }

  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setError("Copy was blocked by your browser. Please select and copy the text manually."); }
  }

  return (
    <main className="landing-container landing-section mx-auto w-full max-w-5xl">
      <Link href="/pricing" className="inline-flex items-center gap-2 text-sm text-muted mb-8"><ArrowLeft size={16} /> Back to pricing</Link>
      <div className="grid gap-8 md:grid-cols-[1.1fr_.9fr]">
        <section className="panel p-6 md:p-8">
          <span className="eyebrow">ALPHA.AI · SECURE UPI CHECKOUT</span>
          <h1 className="text-3xl font-semibold mt-3">Complete your order</h1>
          <p className="text-muted mt-3">Create an order for the selected plan, then pay using any UPI app that supports UPI intent links.</p>
          <div className="mt-7 rounded-xl border p-5">
            <div className="flex items-center justify-between gap-4">
              <div><h2 className="text-xl font-semibold">{plan.name}</h2><p className="text-sm text-muted mt-1">{billing === "yearly" ? "Annual billing" : "Monthly billing"}</p></div>
              <div className="text-right"><div className="text-2xl font-semibold">{money(amount)}</div><div className="text-xs text-muted">{billing === "yearly" ? "per year" : "per month"}</div></div>
            </div>
            <div className="h-px bg-current opacity-10 my-5" />
            <p className="text-sm font-medium">{plan.minutes}</p>
            <ul className="grid gap-3 mt-4">{plan.features.map((feature) => <li key={feature} className="flex items-start gap-2 text-sm"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{feature}</li>)}</ul>
          </div>

          {!session?.access_token ? (
            <div className="mt-6 rounded-xl border p-5">
              <div className="flex items-center gap-2 font-medium"><LockKeyhole size={17} /> Sign in to continue</div>
              <p className="text-sm text-muted mt-2">We attach each order to your account so someone else cannot submit or change its payment status.</p>
              <Link href="/studio" className="mt-4 inline-flex w-full items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold">Sign in to Alpha.ai <ExternalLink size={15} className="ml-2" /></Link>
            </div>
          ) : !order ? (
            <button onClick={createOrder} disabled={loading} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold" style={{ background: "var(--az-primary, #7c5cff)", color: "white", opacity: loading ? .7 : 1 }}>
              {loading ? <RefreshCw size={17} className="animate-spin" /> : <LockKeyhole size={17} />} {loading ? "Creating secure order…" : "Generate QR & payment options"}
            </button>
          ) : (
            <div className="mt-6 rounded-xl border p-5">
              <div className="flex items-start justify-between gap-3"><div><span className="eyebrow">ORDER CREATED</span><h2 className="text-lg font-semibold mt-1">{money(order.amount)} · {plan.name}</h2><p className="text-xs text-muted mt-1">Reference: {order.reference}</p></div><span className="text-xs rounded-full border px-3 py-1">{order.status === "submitted" ? "Under review" : "Awaiting payment"}</span></div>
              {order.status !== "submitted" && <>
                <div className="mt-5 flex justify-center rounded-xl bg-white p-3"><img src={qrUrl} alt={"UPI payment QR for " + money(order.amount)} width="280" height="280" className="h-auto w-full max-w-[280px]" /></div>
                <p className="text-center text-xs text-muted mt-2">Scan with your UPI app. Confirm the payee and amount before paying.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <a href={upiUri} className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold" style={{ background: "var(--az-primary, #7c5cff)", color: "white" }}>Open UPI app <ExternalLink size={15} /></a>
                  <button onClick={() => copyText(upiUri)} className="inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium"><Copy size={15} /> {copied ? "Copied" : "Copy UPI payment link"}</button>
                </div>
                <div className="mt-5 rounded-lg border p-4">
                  <p className="text-sm font-medium">Payee UPI ID</p><div className="mt-2 flex items-center justify-between gap-2"><code className="text-sm">{payeeVpa}</code><button aria-label="Copy UPI ID" onClick={() => copyText(payeeVpa)} className="rounded-md border p-2"><Copy size={14}/></button></div>
                  <p className="text-sm font-medium mt-4">Amount</p><div className="mt-1 flex items-center justify-between gap-2"><strong>{money(order.amount)}</strong><button aria-label="Copy amount" onClick={() => copyText(String(order.amount))} className="rounded-md border p-2"><Copy size={14}/></button></div>
                  <p className="text-xs text-muted mt-3">Use Google Pay, PhonePe, Paytm, BHIM, or another UPI app. App availability depends on your device and installed apps.</p>
                </div>
                <button onClick={confirmPaymentIntent} disabled={submitting} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold">{submitting ? "Updating order…" : "I’ve completed the UPI payment"}</button>
                <p className="mt-2 text-xs text-muted">No transaction ID needed. This only requests a payment check; your plan stays inactive until payment is verified.</p>
              </>}
              {order.status === "submitted" && <p className="mt-4 text-sm">Your order is awaiting payment verification. Your subscription is not active yet; it will activate only after payment is verified.</p>}
            </div>
          )}
          {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/40 p-3 text-sm">{error}</p>}
          {notice && <p role="status" className="mt-4 rounded-lg border p-3 text-sm">{notice}</p>}
          <div className="mt-6 flex items-start gap-2 rounded-xl border p-4 text-sm text-muted"><ShieldCheck size={18} className="shrink-0 mt-0.5" /><p>QR and UPI intent start a payment only. Tapping the confirmation button does not prove payment. Alpha.ai activates paid access only after payment is verified.</p></div>
        </section>
        <aside className="panel p-6 md:p-8 h-fit">
          <h2 className="text-lg font-semibold">Order summary</h2>
          <div className="flex justify-between gap-4 mt-6 text-sm"><span className="text-muted">{plan.name} plan</span><span>{money(amount)}</span></div>
          <div className="flex justify-between gap-4 mt-3 text-sm"><span className="text-muted">Billing cycle</span><span>{billing === "yearly" ? "Annual" : "Monthly"}</span></div>
          <div className="h-px bg-current opacity-10 my-5" />
          <div className="flex justify-between gap-4 font-semibold"><span>Total due</span><span>{money(amount)}</span></div>
          <p className="text-xs text-muted mt-3">All prices are shown in INR. Your order expires after 30 minutes if it is not completed.</p>
          <Link href="/pricing" className="mt-6 inline-flex w-full items-center justify-center rounded-lg border px-4 py-3 text-sm font-medium">Change plan</Link>
        </aside>
      </div>
    </main>
  );
}
export default function CheckoutPage() {
  return <Suspense fallback={<main className="landing-container landing-section"><p>Loading checkout…</p></main>}><CheckoutContent /></Suspense>;
}

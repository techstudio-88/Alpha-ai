"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, LockKeyhole } from "lucide-react";
import { Suspense } from "react";

function CheckoutContent() {
  const searchParams = useSearchParams();
  const planKey = (searchParams.get("plan") || "creator").toLowerCase();
  const billing = searchParams.get("billing") === "annual" ? "annual" : "monthly";
  const plan = useMemo(() => {
    if (planKey === "studio") return { name: "Studio", monthly: 59, annualMonthly: 47, minutes: "600 source minutes/month (planned)", features: ["Team workspaces", "Shared brand presets", "Team support"] };
    return { name: "Creator", monthly: 19, annualMonthly: 15, minutes: "120 source minutes/month (planned)", features: ["One creator workspace", "Saved caption styles", "Priority processing"] };
  }, [planKey]);
  const price = billing === "annual" ? plan.annualMonthly : plan.monthly;

  return (
    <main className="landing-container landing-section mx-auto w-full max-w-5xl">
      <Link href="/pricing" className="inline-flex items-center gap-2 text-sm text-muted mb-8"><ArrowLeft size={16} /> Back to pricing</Link>
      <div className="grid gap-8 md:grid-cols-[1.1fr_.9fr]">
        <section className="panel p-6 md:p-8">
          <span className="eyebrow">SECURE CHECKOUT</span>
          <h1 className="text-3xl font-semibold mt-3">Review your plan</h1>
          <p className="text-muted mt-3">Confirm the plan you selected before proceeding to payment.</p>
          <div className="mt-8 rounded-xl border p-5">
            <div className="flex items-center justify-between gap-4">
              <div><h2 className="text-xl font-semibold">{plan.name}</h2><p className="text-sm text-muted mt-1">{billing === "annual" ? "Annual billing" : "Monthly billing"}</p></div>
              <div className="text-right"><div className="text-2xl font-semibold">${price}</div><div className="text-xs text-muted">per month, proposed</div></div>
            </div>
            <div className="h-px bg-current opacity-10 my-5" />
            <p className="text-sm font-medium">{plan.minutes}</p>
            <ul className="grid gap-3 mt-4">{plan.features.map((feature) => <li key={feature} className="flex items-start gap-2 text-sm"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{feature}</li>)}</ul>
          </div>
          <div className="mt-6 rounded-xl border p-4">
            <div className="flex items-center gap-2 font-medium"><LockKeyhole size={17} /> Payment status</div>
            <p className="text-sm text-muted mt-2">Online payments are not enabled yet. No money will be charged on this page. We need to connect and verify the payment provider before enabling a real payment button.</p>
          </div>
          <div className="mt-6 rounded-lg border px-4 py-3 text-center text-sm font-medium text-muted" role="status">Checkout is ready for plan review, but payments are not enabled yet.</div>
        </section>
        <aside className="panel p-6 md:p-8 h-fit">
          <h2 className="text-lg font-semibold">Order summary</h2>
          <div className="flex justify-between gap-4 mt-6 text-sm"><span className="text-muted">{plan.name} plan</span><span>${price}/mo</span></div>
          <div className="flex justify-between gap-4 mt-3 text-sm"><span className="text-muted">Billing cycle</span><span>{billing === "annual" ? "Annual" : "Monthly"}</span></div>
          <div className="h-px bg-current opacity-10 my-5" />
          <div className="flex justify-between gap-4 font-semibold"><span>Total due today</span><span>$0.00</span></div>
          <p className="text-xs text-muted mt-3">This is a plan review only; the paid tier and displayed price are proposals, not an active subscription offer.</p>
          <Link href="/pricing" className="mt-6 inline-flex w-full items-center justify-center rounded-lg px-4 py-3 text-sm font-medium">Change plan</Link>
        </aside>
      </div>
    </main>
  );
}

export default function CheckoutPage() {
  return <Suspense fallback={<main className="landing-container landing-section"><p>Loading checkout…</p></main>}><CheckoutContent /></Suspense>;
}

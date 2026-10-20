"use client";
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { studioApi, useStudio } from './data';
import { Button, Input } from './ui';
const money = paise => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(paise || 0) / 100);
const utrPattern = /^\d{12}$/;
export default function UpiCheckout({ workspaceId, plan, interval = 'monthly', onClose, onDone }) {
  const { notify, refreshWorkspace } = useStudio();
  const [order, setOrder] = useState(null), [upi, setUpi] = useState(''), [qr, setQr] = useState(''), [utr, setUtr] = useState(''), [payerNote, setPayerNote] = useState(''), [status, setStatus] = useState('creating'), [error, setError] = useState(''), [reviewNote, setReviewNote] = useState(''), [now, setNow] = useState(Date.now()), [mobile, setMobile] = useState(false), [submitting, setSubmitting] = useState(false);
  const handled = useRef(false);
  const expired = Boolean(order?.expires_at && now >= new Date(order.expires_at).getTime());
  const secondsLeft = order?.expires_at ? Math.max(0, Math.floor((new Date(order.expires_at).getTime() - now) / 1000)) : 0;
  const createOrder = useCallback(async () => {
    setStatus('creating'); setError(''); setReviewNote(''); setOrder(null); setUpi(''); setQr(''); setUtr(''); setPayerNote(''); handled.current = false;
    try { const result = await studioApi('/api/billing/upi/order', { body: { workspaceId, plan, interval } }); setOrder(result.order); setUpi(result.upi); setStatus('pending'); setQr(await QRCode.toDataURL(result.upi, { margin: 1, width: 280, errorCorrectionLevel: 'M' })); }
    catch (err) { setError(err.message || 'Could not create a UPI order.'); setStatus('error'); }
  }, [workspaceId, plan, interval]);
  useEffect(() => { setMobile(/Android|iPhone/i.test(navigator.userAgent)); createOrder(); }, [createOrder]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!order?.id || status === 'creating' || status === 'error' || handled.current) return;
    let alive = true;
    const check = async () => {
      if (!supabase || handled.current) return;
      const { data, error: pollError } = await supabase.from('upi_payment_orders').select('status,review_note').eq('id', order.id).maybeSingle();
      if (!alive || pollError || !data) return;
      if (data.status === 'approved' && !handled.current) { handled.current = true; setStatus('approved'); notify('Payment verified. Your plan is active.'); await refreshWorkspace?.(); onDone?.(); }
      else if (data.status === 'rejected') { setStatus('rejected'); setReviewNote(data.review_note || 'Please contact support if you believe this is incorrect.'); }
      else if (data.status === 'submitted') setStatus(current => current === 'pending' ? 'submitted' : current);
    };
    check(); const timer = setInterval(check, 15000); return () => { alive = false; clearInterval(timer); };
  }, [order?.id, status, notify, refreshWorkspace, onDone]);
  async function submitUtr(event) {
    event.preventDefault(); setError('');
    if (!utrPattern.test(utr)) { setError('Enter the 12-digit UTR from your UPI app.'); return; }
    if (expired) { setError('This QR expired. Create a new order to pay.'); return; }
    setSubmitting(true);
    try { await studioApi('/api/billing/upi/submit', { body: { workspaceId, orderId: order.id, utr, payerNote } }); setStatus('submitted'); notify('Payment submitted for verification.'); }
    catch (err) { setError(err.message || 'Could not submit the transaction ID.'); }
    finally { setSubmitting(false); }
  }
  return <div className="space-y-4">
    {status === 'creating' && <p role="status" className="text-sm text-muted">Creating a secure payment order…</p>}
    {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm">{error}</p>}
    {order && <>
      <div className="flex items-start justify-between gap-4"><div><p className="text-sm text-muted">{plan === 'pro' ? 'Creator' : 'Studio'} · {interval === 'yearly' ? 'Yearly' : 'Monthly'}</p><p className="text-2xl font-semibold">{money(order.amount_paise)}</p><p className="text-xs text-muted">Order {order.reference}</p></div><p className="text-sm tabular-nums">{expired ? 'Expired' : String(Math.floor(secondsLeft / 60)).padStart(2,'0') + ':' + String(secondsLeft % 60).padStart(2,'0') + ' left'}</p></div>
      {expired && !['approved', 'submitted', 'rejected'].includes(status) ? <div className="space-y-3"><p className="font-medium">This QR expired</p><Button variant="primary" onClick={createOrder}>Create a new order</Button></div> : <>
        {mobile && <a href={upi} className="button button-primary block w-full text-center">Pay in UPI app</a>}
        <div className="mx-auto w-fit rounded-2xl bg-white p-4 shadow-sm"><div className="min-h-[280px] min-w-[280px] flex items-center justify-center">{qr ? <img src={qr} alt="UPI payment QR code" width="280" height="280" /> : <span className="text-sm text-slate-600">Preparing QR…</span>}</div></div>
        <p className="text-center text-xs text-muted">UPI only. No cards. Your plan activates after we verify the payment.</p>
        {status === 'approved' ? <p role="status" className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm">Payment verified. Your plan is active.</p> : status === 'rejected' ? <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm">Payment needs attention: {reviewNote}</p> : status === 'submitted' ? <p role="status" className="rounded-lg border border-border p-3 text-sm">Payment submitted. We activate your plan after we verify the payment, usually within a few hours.</p> : <form onSubmit={submitUtr} className="space-y-3"><label className="block text-sm font-medium" htmlFor="upi-utr">Step 2 · I’ve paid</label><Input id="upi-utr" value={utr} onChange={e => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" maxLength={12} placeholder="12-digit UTR" autoComplete="off"/><Input value={payerNote} onChange={e => setPayerNote(e.target.value.slice(0,240))} placeholder="Optional payer app note" aria-label="Optional payer app note"/><Button type="submit" variant="primary" disabled={submitting || !utrPattern.test(utr)} busy={submitting}>Submit transaction ID</Button></form>}
      </>}
    </>}
    <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
  </div>;
}

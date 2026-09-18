"use client";

import { useEffect, useState } from "react";
import { Check, ArrowRight, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "../../../lib/supabase";

export default function ConfirmEmailPage() {
  const [status, setStatus] = useState("verifying");
  const [message, setMessage] = useState("Securing your Alpha.ai account…");
  const [seconds, setSeconds] = useState(4);

  useEffect(() => {
    let active = true;

    async function verify() {
      if (!supabase) {
        setStatus("error");
        setMessage("Authentication is not configured.");
        return;
      }

      const url = new URL(window.location.href);
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type") || "email";

      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type,
        });

        if (error) {
          if (active) {
            setStatus("error");
            setMessage(error.message || "This verification link is invalid or has expired.");
          }
          return;
        }

        if (active) {
          setStatus("success");
          setMessage("Your email is verified. Welcome to Alpha.ai.");
        }
        return;
      }

      // Also support Supabase's client-side implicit-flow callback in case
      // an older confirmation email still redirects with access/refresh tokens.
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          if (active) {
            setStatus("error");
            setMessage(error.message || "We couldn't complete email verification.");
          }
          return;
        }

        if (active) {
          setStatus("success");
          setMessage("Your email is verified. Welcome to Alpha.ai.");
        }
        return;
      }

      const { data } = await supabase.auth.getUser();
      if (data?.user?.email_confirmed_at) {
        if (active) {
          setStatus("success");
          setMessage("Your email is already verified. Welcome back.");
        }
      } else if (active) {
        setStatus("error");
        setMessage("No verification token was found. Please request a fresh verification email.");
      }
    }

    verify();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (status !== "success") return;
    if (seconds <= 0) {
      window.location.assign("/");
      return;
    }
    const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [status, seconds]);

  return (
    <main className="verifyPage">
      <div className="verifyGlow glowOne" />
      <div className="verifyGlow glowTwo" />

      <section className="verifyCard" aria-live="polite">
        <div className={status === "success" ? "verifyIcon success" : status === "error" ? "verifyIcon error" : "verifyIcon loading"}>
          {status === "success" ? <Check size={42} strokeWidth={2.5} /> : status === "error" ? <XCircle size={42} /> : <Loader2 size={40} className="spin" />}
        </div>

        <div className="verifyBrand">
          <span className="verifyMark" />
          <span>Alpha.ai</span>
        </div>

        {status === "verifying" && (
          <>
            <div className="verifyKicker"><ShieldCheck size={15} /> EMAIL VERIFICATION</div>
            <h1>Verifying your email<span className="ellipsis">...</span></h1>
            <p>{message}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="verifyKicker successText"><Check size={15} /> VERIFIED SUCCESSFULLY</div>
            <h1>You’re all set.</h1>
            <p>{message}</p>
            <div className="verifyProgress"><span /></div>
            <p className="verifyCountdown">Taking you to Alpha.ai in {seconds}s</p>
            <button className="btn primary verifyButton" onClick={() => window.location.assign("/")}>
              Continue to Alpha.ai <ArrowRight size={17} />
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="verifyKicker errorText"><XCircle size={15} /> VERIFICATION NEEDS ATTENTION</div>
            <h1>We couldn’t verify that link.</h1>
            <p>{message}</p>
            <button className="btn primary verifyButton" onClick={() => window.location.assign("/")}>
              Back to Alpha.ai <ArrowRight size={17} />
            </button>
          </>
        )}

        <div className="verifyFooter">Secure account verification · Alpha.ai</div>
      </section>
    </main>
  );
}

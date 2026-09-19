import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return NextResponse.redirect(new URL("/?auth_error="+encodeURIComponent(errorDescription || error), url.origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?auth_error=Missing%20OAuth%20code", url.origin));
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !data.session) {
    return NextResponse.redirect(new URL("/?auth_error="+encodeURIComponent(exchangeError?.message || "OAuth session exchange failed"), url.origin));
  }

  const target = new URL("/", url.origin);
  target.hash = new URLSearchParams({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: String(data.session.expires_in ?? 3600),
    token_type: data.session.token_type || "bearer"
  }).toString();
  return NextResponse.redirect(target);
}

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

  try{const ref=request.cookies.get("alpha_ref")?.value||null;const service=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;if(service&&ref){const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,service,{auth:{persistSession:false}});await admin.from("content_attribution").insert({user_id:data.session.user.id,anonymous_id:null,content_id:ref,source:"referral",medium:"referral",campaign:ref,landing_path:"/",signup_at:new Date().toISOString(),metadata:{referral_code:ref}});await admin.from("referrals").update({referred_user_id:data.session.user.id,referred_at:new Date().toISOString()}).eq("code",ref).is("referred_user_id",null).catch(()=>{})}}catch(e){console.warn("signup attribution failed:",e.message)}

  const target = new URL("/", url.origin);
  target.hash = new URLSearchParams({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: String(data.session.expires_in ?? 3600),
    token_type: data.session.token_type || "bearer"
  }).toString();
  return NextResponse.redirect(target);
}

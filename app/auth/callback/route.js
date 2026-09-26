import { NextResponse } from "next/server";

export async function GET(request) {
  const url = new URL(request.url);
  const nextParam = url.searchParams.get("next") || "/";
  let target = new URL("/", url.origin);

  try {
    const candidate = new URL(nextParam, url.origin);
    if (candidate.origin === url.origin && candidate.pathname.startsWith("/")) target = candidate;
  } catch {}

  // The browser Supabase client owns the PKCE verifier, so return the auth
  // code to that same browser instead of exchanging it on the server.
  for (const key of ["code", "sb_flow_id", "error", "error_description", "error_code"]) {
    const value = url.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }

  return NextResponse.redirect(target);
}

import { NextResponse } from "next/server";

export async function GET(request) {
  const url = new URL(request.url);
  const target = new URL("/", url.origin);

  // This app uses the browser Supabase client with PKCE. The PKCE verifier
  // lives in the initiating browser's local storage, so the code must be
  // returned to that browser instead of being exchanged on the server.
  for (const key of ["code", "sb_flow_id", "error", "error_description", "error_code"]) {
    const value = url.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }

  return NextResponse.redirect(target);
}

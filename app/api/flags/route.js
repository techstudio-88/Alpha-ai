import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return Response.json({ error: 'Feature flags are not configured.' }, { status: 503 });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.from('feature_flags').select('key,enabled');
  if (error) return Response.json({ error: 'Could not load feature flags.' }, { status: 503 });
  return Response.json({ flags: Object.fromEntries((data || []).map(flag => [flag.key, Boolean(flag.enabled)])) }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}

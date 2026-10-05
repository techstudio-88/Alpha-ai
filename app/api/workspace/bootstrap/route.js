import {createClient} from '@supabase/supabase-js';
import {bootstrapWorkspace} from '../../../../lib/workspace-bootstrap.mjs';

export const runtime = 'nodejs';
export async function POST(request) {
  try {
    const authorization = request.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return Response.json({error:'Authentication required.'}, {status:401});
    const token = authorization.slice(7);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !anon || !service) return Response.json({error:'Workspace setup is not configured.'}, {status:503});
    const options = {auth:{persistSession:false,autoRefreshToken:false}};
    const {data:{user},error} = await createClient(url,anon,options).auth.getUser(token);
    if (error || !user) return Response.json({error:'Authentication expired.'}, {status:401});
    const workspace = await bootstrapWorkspace(createClient(url,service,options),user);
    return Response.json({workspace});
  } catch {
    return Response.json({error:'Unable to prepare your workspace. Please retry.'}, {status:500});
  }
}

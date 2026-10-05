export const runtime='nodejs';
export async function GET(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return Response.json({configured:false},{headers:{'Cache-Control':'no-store'}});
  try{
    const response=await fetch(url+'/auth/v1/settings',{headers:{apikey:key},cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('settings');
    const settings=await response.json();
    return Response.json({configured:true,githubEnabled:Boolean(settings.external?.github),emailEnabled:Boolean(settings.external?.email),emailConfirmationRequired:settings.mailer_autoconfirm!==true},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({configured:true,githubEnabled:null,emailConfirmationRequired:null},{headers:{'Cache-Control':'no-store'}})}
}

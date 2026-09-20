import{createClient}from "@supabase/supabase-js";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase=url&&key?createClient(url,key,{
  auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
}):null;

// Keep API requests authenticated even when a component calls fetch() directly.
// This also refreshes an expiring/expired Supabase session before protected API calls.
if(typeof window!=="undefined"&&supabase&&!window.__alphaAuthenticatedFetch){
  const nativeFetch=window.fetch.bind(window);
  const protectedPaths=["/api/import-source","/api/google-drive/import"];
  const isProtected=(input)=>{
    const raw=typeof input==="string"?input:(input&&input.url)||"";
    try{return protectedPaths.some((path)=>new URL(raw,window.location.origin).pathname===path)}catch{return false}
  };
  const getFreshToken=async()=>{
    let{data}=await supabase.auth.getSession();
    let session=data?.session;
    const expiresAt=Number(session?.expires_at||0);
    if(!session?.access_token||!expiresAt||expiresAt*1000<Date.now()+60000){
      const refreshed=await supabase.auth.refreshSession();
      session=refreshed.data?.session||session;
    }
    return session?.access_token||"";
  };
  window.fetch=async(input,init={})=>{
    if(!isProtected(input))return nativeFetch(input,init);
    const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
    let token=headers.get("Authorization")?.replace(/^Bearer\s*/i,"")||"";
    if(!token)token=await getFreshToken();
    if(token)headers.set("Authorization","Bearer "+token);
    const first=await nativeFetch(input,{...init,headers});
    if(first.status!==401)return first;
    const refreshed=await supabase.auth.refreshSession();
    const nextToken=refreshed.data?.session?.access_token||"";
    if(!nextToken)return first;
    headers.set("Authorization","Bearer "+nextToken);
    return nativeFetch(input,{...init,headers});
  };
  window.__alphaAuthenticatedFetch=true;
}

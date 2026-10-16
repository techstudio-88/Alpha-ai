import {createClient} from "@supabase/supabase-js";

const admin=()=>createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const publicClient=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});

async function userFromRequest(req){
  const authorization=req.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))return null;
  const {data}=await publicClient().auth.getUser(authorization.slice(7));
  return data?.user||null;
}
async function isWorkspaceMember(userId,workspaceId){
  const {data,error}=await admin().from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",userId).maybeSingle();
  if(error)throw error;
  return Boolean(data);
}

export async function GET(req){
  try{
    const user=await userFromRequest(req);
    if(!user)return Response.json({error:"Unauthorized"},{status:401});
    const workspaceId=new URL(req.url).searchParams.get("workspace_id");
    if(!workspaceId||!await isWorkspaceMember(user.id,workspaceId))return Response.json({error:"Forbidden"},{status:403});
    const {data,error}=await admin().from("content_plans").select("*").eq("workspace_id",workspaceId).order("scheduled_for",{ascending:true,nullsFirst:false});
    if(error)throw error;
    return Response.json({plans:data||[]});
  }catch(error){return Response.json({error:error?.message||"Unable to load content plans."},{status:error?.status||500});}
}

export async function POST(req){
  try{
    const user=await userFromRequest(req);
    if(!user)return Response.json({error:"Unauthorized"},{status:401});
    const body=await req.json();
    const workspaceId=body.workspace_id;
    if(!workspaceId||!await isWorkspaceMember(user.id,workspaceId))return Response.json({error:"Forbidden"},{status:403});
    if(body.scheduled_for){
      const scheduledFor=new Date(body.scheduled_for);
      if(!Number.isFinite(scheduledFor.getTime()))return Response.json({error:"Invalid scheduled_for date"},{status:400});
      if(scheduledFor.getTime()>Date.now()+60000){
        const {data:entitlement,error}=await admin().from("workspace_entitlements").select("scheduling_enabled").eq("workspace_id",workspaceId).maybeSingle();
        if(error)return Response.json({error:"Entitlements could not be checked."},{status:503});
        if(!entitlement?.scheduling_enabled)return Response.json({error:"Scheduling is not included in your plan."},{status:402});
      }
    }
    const row={
      workspace_id:workspaceId,user_id:user.id,
      keyword:String(body.keyword||"").slice(0,200),
      search_intent:String(body.search_intent||"informational"),
      clip_id:body.clip_id||null,platform:body.platform||null,
      scheduled_for:body.scheduled_for||null,caption:body.caption||null,
      hashtags:Array.isArray(body.hashtags)?body.hashtags:[],
      content_type:body.content_type||"video",status:body.status||"idea",
      metadata:body.metadata||{}
    };
    const {data,error}=await admin().from("content_plans").insert(row).select("*").single();
    if(error){
      if(/SCHEDULING_NOT_INCLUDED_IN_PLAN/.test(error.message||""))return Response.json({error:"Scheduling is not included in your plan."},{status:402});
      throw error;
    }
    return Response.json(data);
  }catch(error){return Response.json({error:error?.message||"Unable to create content plan."},{status:error?.status||500});}
}

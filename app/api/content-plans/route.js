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
const jsonError=(error,fallback)=>Response.json({error:fallback,errorId:crypto.randomUUID()},{status:error?.status||500});

export async function GET(req){
  try{
    const user=await userFromRequest(req);
    if(!user)return Response.json({error:"Unauthorized"},{status:401});
    const workspaceId=new URL(req.url).searchParams.get("workspace_id");
    if(!workspaceId||!await isWorkspaceMember(user.id,workspaceId))return Response.json({error:"Workspace access denied."},{status:403});
    const {data,error}=await admin().from("content_plans").select("*").eq("workspace_id",workspaceId).order("scheduled_for",{ascending:true,nullsFirst:false});
    if(error)throw error;
    return Response.json({plans:data||[]},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    const status=error?.status||500;
    return Response.json({error:status>=500?"Unable to load content plans. Try again shortly.":error.message,errorId:crypto.randomUUID()},{status});
  }
}

export async function POST(req){
  try{
    const user=await userFromRequest(req);
    if(!user)return Response.json({error:"Unauthorized"},{status:401});
    const body=await req.json().catch(()=>null);
    if(!body||typeof body!=="object"||Array.isArray(body))return Response.json({error:"Send a valid JSON request."},{status:400});
    const workspaceId=body.workspace_id;
    if(!workspaceId||!await isWorkspaceMember(user.id,workspaceId))return Response.json({error:"Workspace access denied."},{status:403});
    const keyword=typeof body.keyword==="string"?body.keyword.trim().slice(0,200):"";
    const caption=typeof body.caption==="string"?body.caption.slice(0,5000):null;
    const allowedIntent=new Set(["informational","navigational","commercial","transactional"]);
    const allowedPlatform=new Set(["youtube","tiktok","instagram","facebook","linkedin","x","threads","other"]);
    const allowedContentType=new Set(["video","short","post","carousel","article"]);
    if(!keyword)return Response.json({error:"A keyword is required."},{status:400});
    if(body.search_intent!=null&&!allowedIntent.has(body.search_intent))return Response.json({error:"Choose a valid search intent."},{status:400});
    if(body.platform!=null&&!allowedPlatform.has(body.platform))return Response.json({error:"Choose a supported platform."},{status:400});
    if(body.content_type!=null&&!allowedContentType.has(body.content_type))return Response.json({error:"Choose a supported content type."},{status:400});
    if(body.hashtags!=null&&(!Array.isArray(body.hashtags)||body.hashtags.length>40||body.hashtags.some(tag=>typeof tag!=="string"||tag.length>100)))return Response.json({error:"Hashtags must be a list of up to 40 short text values."},{status:400});
    if(body.metadata!=null&&(!body.metadata||typeof body.metadata!=="object"||Array.isArray(body.metadata)))return Response.json({error:"Metadata must be an object."},{status:400});
    if(body.clip_id!=null&&typeof body.clip_id!=="string")return Response.json({error:"Invalid clip reference."},{status:400});
    if(body.scheduled_for){
      const scheduledFor=new Date(body.scheduled_for);
      if(!Number.isFinite(scheduledFor.getTime()))return Response.json({error:"Invalid scheduled_for date."},{status:400});
      if(scheduledFor.getTime()>Date.now()+60000){
        const {data:entitlement,error}=await admin().from("workspace_entitlements").select("scheduling_enabled").eq("workspace_id",workspaceId).maybeSingle();
        if(error)return Response.json({error:"Entitlements could not be checked. Retry shortly."},{status:503});
        if(!entitlement?.scheduling_enabled)return Response.json({error:"Scheduling is not included in your plan."},{status:402});
      }
    }
    const row={
      workspace_id:workspaceId,user_id:user.id,
      keyword,
      search_intent:body.search_intent||"informational",
      clip_id:body.clip_id||null,platform:body.platform||null,
      scheduled_for:body.scheduled_for||null,caption,
      hashtags:Array.isArray(body.hashtags)?body.hashtags.map(tag=>tag.trim().replace(/^#/,"").slice(0,100)):[],
      content_type:body.content_type||"video",
      status:"idea",
      metadata:body.metadata||{}
    };
    const {data,error}=await admin().from("content_plans").insert(row).select("*").single();
    if(error){
      if(/SCHEDULING_NOT_INCLUDED_IN_PLAN/.test(error.message||""))return Response.json({error:"Scheduling is not included in your plan."},{status:402});
      throw error;
    }
    return Response.json(data,{status:201,headers:{"Cache-Control":"no-store"}});
  }catch(error){
    const status=error?.status||500;
    return Response.json({error:status>=500?"Unable to create content plan. Try again shortly.":error.message,errorId:crypto.randomUUID()},{status});
  }
}

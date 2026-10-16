import {createHash,randomUUID} from "node:crypto";
import {checkRateLimit,rateLimitResponse} from "../../../../lib/rate-limit";
export const runtime="nodejs";
export async function POST(request){
  const errorId=randomUUID();
  try{
    const body=await request.json().catch(()=>({}));
    const email=String(body?.email||"").trim().toLowerCase();
    const emailIdentity=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ?"email:"+createHash("sha256").update(email).digest("hex"):null;
    const rate=await checkRateLimit(request,{endpoint:"auth",userId:emailIdentity,plan:"free"});
    const blocked=rateLimitResponse(rate);
    if(blocked)return blocked;
    return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
  }catch{
    console.error("auth_rate_limit_failure",{errorId});
    return Response.json({error:"Sign-in protection is temporarily unavailable. Please retry shortly.",errorId},
      {status:503,headers:{"Cache-Control":"no-store","Retry-After":"60"}});
  }
}

import {createHash} from "node:crypto";

const limits = {
  free: {auth: {user:5,ip:20}, upload_start:{user:5,ip:20}, ai_call:{user:12,ip:40}, link_fetch:{user:10,ip:30}, api:{user:60,ip:120}},
  pro: {auth:12,ip:60,upload_start:{user:20,ip:60},ai_call:{user:60,ip:120},link_fetch:{user:40,ip:100},api:{user:300,ip:600}},
  studio: {auth:20,ip:100,upload_start:{user:60,ip:160},ai_call:{user:180,ip:360},link_fetch:{user:120,ip:300},api:{user:900,ip:1800}}
};
const WINDOW_SECONDS=60;
const digest=value=>createHash("sha256").update(String(value||"unknown")).digest("hex");
function safePlan(value){return ["free","pro","studio"].includes(String(value||"").toLowerCase())?String(value).toLowerCase():"free";}
function getLimit(plan,endpoint,kind){
  const row=limits[safePlan(plan)]?.[endpoint]||limits[safePlan(plan)].api;
  if(kind==="ip")return typeof row==="number"?row:(row.ip||120);
  return typeof row==="number"?row:(row.user||60);
}

// Uses Upstash's REST EVAL endpoint for atomic INCR+EXPIRE. Raw IPs and user IDs
// are hashed before storage; no request body, credentials, or source URL is recorded.
async function increment(key,limit){
  const base=(process.env.UPSTASH_REDIS_REST_URL||"").replace(/\\/$/,"");
  const token=process.env.UPSTASH_REDIS_REST_TOKEN||"";
  if(!base||!token)return {unavailable:true};
  const script="local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; local ttl=redis.call('TTL',KEYS[1]); return {n,ttl}";
  try{
    const response=await fetch(base,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify(["EVAL",script,1,key,WINDOW_SECONDS]),cache:"no-store",signal:AbortSignal.timeout(2500)});
    if(!response.ok)return {unavailable:true};
    const data=await response.json();
    const result=data?.result;
    if(!Array.isArray(result)||!Number.isFinite(Number(result[0])))return {unavailable:true};
    return {allowed:Number(result[0])<=limit,retryAfter:Math.max(1,Number(result[1])||WINDOW_SECONDS)};
  }catch{return {unavailable:true}}
}

export async function checkRateLimit(request,{endpoint,userId=null,plan="free"}={}){
  const ip=(request.headers.get("x-forwarded-for")||request.headers.get("x-real-ip")||"").split(",")[0].trim()||"unknown";
  const checks=[];
  if(userId)checks.push({key:"alpha:rl:"+endpoint+":u:"+digest(userId),limit:getLimit(plan,endpoint,"user")});
  checks.push({key:"alpha:rl:"+endpoint+":i:"+digest(ip),limit:getLimit(plan,endpoint,"ip")});
  for(const check of checks){
    const result=await increment(check.key,check.limit);
    if(result.unavailable)return {allowed:false,unavailable:true,retryAfter:WINDOW_SECONDS};
    if(!result.allowed)return {allowed:false,unavailable:false,retryAfter:result.retryAfter};
  }
  return {allowed:true};
}
export function rateLimitResponse(result){
  if(result?.allowed)return null;
  const errorId=cryptoRandomId();
  if(result?.unavailable)return Response.json({error:"The request protection service is temporarily unavailable. Please try again shortly.",errorId},
    {status:503,headers:{"Cache-Control":"no-store","Retry-After":String(result.retryAfter||WINDOW_SECONDS)}});
  return Response.json({error:"You're sending requests too quickly. Please wait and try again.",errorId},
    {status:429,headers:{"Cache-Control":"no-store","Retry-After":String(result.retryAfter||WINDOW_SECONDS)}});
}
function cryptoRandomId(){
  // Browser crypto is intentionally not used; this helper is server-only.
  return createHash("sha256").update(String(Date.now())+":"+Math.random()).digest("hex").slice(0,32);
}

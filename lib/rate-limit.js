import {createHash,randomUUID} from "node:crypto";
import {connect as connectTcp} from "node:net";
import {connect as connectTls} from "node:tls";

const limits = {
  free: {auth: {user:5,ip:20}, upload_start:{user:5,ip:20}, ai_call:{user:12,ip:40}, link_fetch:{user:10,ip:30}, api:{user:60,ip:120}},
  pro: {auth:{user:12,ip:60},upload_start:{user:20,ip:60},ai_call:{user:60,ip:120},link_fetch:{user:40,ip:100},api:{user:300,ip:600}},
  studio: {auth:{user:20,ip:100},upload_start:{user:60,ip:160},ai_call:{user:180,ip:360},link_fetch:{user:120,ip:300},api:{user:900,ip:1800}}
};
const WINDOW_SECONDS=60;
const digest=value=>createHash("sha256").update(String(value||"unknown")).digest("hex");
function safePlan(value){return ["free","pro","studio"].includes(String(value||"").toLowerCase())?String(value).toLowerCase():"free";}
function getLimit(plan,endpoint,kind){
  const row=limits[safePlan(plan)]?.[endpoint]||limits[safePlan(plan)].api;
  if(kind==="ip")return typeof row==="number"?row:(row.ip||120);
  return typeof row==="number"?row:(row.user||60);
}
function encodeRedisCommand(parts){
  const chunks=[Buffer.from('*'+parts.length+'\r\n')];
  for(const part of parts){const value=Buffer.from(String(part));chunks.push(Buffer.from('$'+value.length+'\r\n'),value,Buffer.from('\r\n'))}
  return Buffer.concat(chunks);
}
function parseRedisReply(buffer,offset=0){
  if(offset>=buffer.length)return null;
  const prefix=String.fromCharCode(buffer[offset]);
  const end=buffer.indexOf('\r\n',offset);
  if(end<0)return null;
  const line=buffer.toString('utf8',offset+1,end);
  if(prefix==='+')return {value:line,offset:end+2};
  if(prefix==='-')return {value:new Error(line),offset:end+2};
  if(prefix===':')return {value:Number(line),offset:end+2};
  if(prefix==='$'){
    const size=Number(line);if(size===-1)return {value:null,offset:end+2};
    const start=end+2,finish=start+size;if(buffer.length<finish+2)return null;
    return {value:buffer.toString('utf8',start,finish),offset:finish+2};
  }
  if(prefix==='*'){
    const count=Number(line);if(count===-1)return {value:null,offset:end+2};
    let cursor=end+2;const values=[];
    for(let i=0;i<count;i++){const child=parseRedisReply(buffer,cursor);if(!child)return null;values.push(child.value);cursor=child.offset}
    return {value:values,offset:cursor};
  }
  throw new Error('Unsupported Redis response');
}
async function nativeRedisEval(redisUrl,script,key){
  const url=new URL(redisUrl);
  if(!['redis:','rediss:'].includes(url.protocol)||!url.hostname)throw new Error('Invalid Redis connection URL');
  const host=url.hostname,port=Number(url.port)||6379;
  const commands=[];
  const username=url.username?decodeURIComponent(url.username):'';
  const password=url.password?decodeURIComponent(url.password):'';
  if(password)commands.push(username?['AUTH',username,password]:['AUTH',password]);
  const dbIndex=Number((url.pathname||'/').slice(1));
  if(Number.isInteger(dbIndex)&&dbIndex>0)commands.push(['SELECT',String(dbIndex)]);
  commands.push(['EVAL',script,'1',key,String(WINDOW_SECONDS)]);
  return new Promise((resolve,reject)=>{
    let buffer=Buffer.alloc(0),settled=false,replyCount=0,lastValue=null;
    const socket=url.protocol==='rediss:'?connectTls({host,port,servername:host,rejectUnauthorized:true}):connectTcp({host,port});
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value)};
    const timer=setTimeout(()=>finish(new Error('Redis request timed out')),2500);
    socket.once(url.protocol==='rediss:'?'secureConnect':'connect',()=>{for(const command of commands)socket.write(encodeRedisCommand(command))});
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      try{
        while(replyCount<commands.length){
          const reply=parseRedisReply(buffer);if(!reply)break;
          buffer=buffer.subarray(reply.offset);replyCount++;
          if(reply.value instanceof Error)throw reply.value;
          lastValue=reply.value;
        }
        if(replyCount===commands.length)finish(null,lastValue);
      }catch(error){finish(error)}
    });
    socket.on('error',error=>finish(error));
    socket.on('timeout',()=>finish(new Error('Redis request timed out')));
  });
}

// Use Upstash REST when configured, or a standard Redis/Redis TLS URL. Raw identifiers
// are hashed before storage; no request body, credentials, or source URL is recorded.
async function increment(key,limit){
  const baseRaw=process.env.UPSTASH_REDIS_REST_URL||"";
  const base=baseRaw.endsWith("/")?baseRaw.slice(0,-1):baseRaw;
  const token=process.env.UPSTASH_REDIS_REST_TOKEN||"";
  const redisUrl=process.env.REDIS_URL||"";
  const script="local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; local ttl=redis.call('TTL',KEYS[1]); return {n,ttl}";
  if(base&&token){
    try{
      const response=await fetch(base,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
        body:JSON.stringify(["EVAL",script,1,key,WINDOW_SECONDS]),cache:"no-store",signal:AbortSignal.timeout(2500)});
      if(response.ok){
        const data=await response.json(),result=data?.result;
        if(Array.isArray(result)&&Number.isFinite(Number(result[0])))
          return {allowed:Number(result[0])<=limit,retryAfter:Math.max(1,Number(result[1])||WINDOW_SECONDS)};
      }
    }catch{}
  }
  if(!redisUrl)return {unavailable:true};
  try{
    const result=await nativeRedisEval(redisUrl,script,key);
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
  const errorId=randomUUID();
  if(result?.unavailable)return Response.json({error:"The request protection service is temporarily unavailable. Please try again shortly.",errorId},
    {status:503,headers:{"Cache-Control":"no-store","Retry-After":String(result.retryAfter||WINDOW_SECONDS)}});
  return Response.json({error:"You're sending requests too quickly. Please wait and try again.",errorId},
    {status:429,headers:{"Cache-Control":"no-store","Retry-After":String(result.retryAfter||WINDOW_SECONDS)}});
}
export async function resolveWorkspacePlan(admin,workspaceId){
  if(!workspaceId)return "free";
  try{
    const {data,error}=await admin.from("workspace_entitlements").select("plan").eq("workspace_id",workspaceId).maybeSingle();
    if(error)return "free";
    return safePlan(data?.plan);
  }catch{return "free"}
}

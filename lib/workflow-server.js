import {createClient} from "@supabase/supabase-js";
import {createHash} from "node:crypto";
import {UUID} from "./video-workflow.mjs";

export function problem(message, status = 400) { return Object.assign(new Error(message), {status}); }
export function checked(result) { if (result.error) throw problem(result.error.message,500); return result.data; }
export async function enforceApiRateLimit(admin, identity, route, limit = 120, windowSeconds = 60, ip = null) {
  const normalizeRoute = value => String(value || "/unknown").slice(0, 200)
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/[0-9]+(?=\/|$)/g, "/:id");
  const normalizedRoute = normalizeRoute(route);
  const consume = async (subject, bucketRoute, bucketLimit) => {
    const keyHash = createHash("sha256").update(String(subject || "")).digest("hex");
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (redisUrl && redisToken) {
      try {
        const epoch = Math.floor(Date.now() / 1000);
        const bucket = Math.floor(epoch / windowSeconds);
        const redisKey = "alpha:rate:" + keyHash + ":" + encodeURIComponent(normalizeRoute(bucketRoute)) + ":" + bucket;
        const response = await fetch(redisUrl.replace(/\/$/, "") + "/pipeline", {
          method: "POST",
          headers: {Authorization: "Bearer " + redisToken, "content-type": "application/json"},
          body: JSON.stringify([["INCR", redisKey], ["EXPIRE", redisKey, windowSeconds]])
        });
        if (response.ok) {
          const values = await response.json();
          const count = Number(values?.[0]?.result);
          if (Number.isFinite(count)) return {
            allowed: count <= bucketLimit, count, limit: bucketLimit,
            retryAfter: Math.max(1, windowSeconds - (epoch % windowSeconds))
          };
        }
        console.warn("Upstash rate-limit request failed; using database fallback.");
      } catch {
        console.warn("Upstash rate-limit request failed; using database fallback.");
      }
    }
    const result = checked(await admin.rpc("consume_api_rate_limit", {
      p_key_hash: keyHash, p_route: bucketRoute, p_limit: bucketLimit, p_window_seconds: windowSeconds
    }));
    return Array.isArray(result) ? result[0] : result;
  };
  const userState = await consume(identity, normalizedRoute, limit);
  if (!userState?.allowed) {
    throw Object.assign(problem("Too many requests. Please wait a moment and try again.", 429), {
      retryAfter: Math.max(1, Number(userState?.retryAfter) || windowSeconds)
    });
  }
  if (ip) {
    const ipState = await consume("ip:" + ip, normalizedRoute, Math.max(limit * 3, limit + 20));
    if (!ipState?.allowed) {
      throw Object.assign(problem("This network has sent too many requests. Please retry shortly.", 429), {
        retryAfter: Math.max(1, Number(ipState?.retryAfter) || windowSeconds)
      });
    }
  }
}
export async function authorizeWorkflow(request, workspaceId) {
  if (!UUID.test(workspaceId || "")) throw problem("A valid workspace is required.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !secret) throw problem("Supabase server credentials are not configured.",503);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw problem("Sign in to continue.",401);
  const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error} = await client.auth.getUser(token);
  if (error || !data.user) throw problem("Your session expired. Sign in again.",401);
  const admin = createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const member = checked(await admin.from("workspace_members").select("workspace_id").eq("workspace_id",workspaceId).eq("user_id",data.user.id).maybeSingle());
  if (!member) throw problem("Workspace access denied.",403);
  const route = new URL(request.url).pathname;
  const baseLimit = route === "/api/ai/chat/plan" ? 8
    : route.startsWith("/api/ai/") || route === "/api/assistant" ? 20
    : route.startsWith("/api/editor/") ? 30
    : 120;
  const {data: entitlement} = await admin.from("workspace_entitlements").select("plan").eq("workspace_id",workspaceId).maybeSingle();
  const multiplier = entitlement?.plan === "studio" ? 3 : entitlement?.plan === "pro" ? 2 : 1;
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  await enforceApiRateLimit(admin, "user:" + data.user.id, route, baseLimit * multiplier, 60, ip);
  return {admin,user:data.user,token};
}
export async function mediaContext(admin, workspaceId, projectId, mediaAssetId) {
  const project = checked(await admin.from("projects").select("id,workspace_id").eq("id",projectId).eq("workspace_id",workspaceId).maybeSingle());
  if (!project) throw problem("Project not found in this workspace.",404);
  if (!mediaAssetId) return {project};
  const asset = checked(await admin.from("media_assets").select("*").eq("id",mediaAssetId).eq("project_id",projectId).maybeSingle());
  if (!asset) throw problem("Video not found in this project.",404);
  return {project,asset};
}
// The DB queue is durable. A sleeping worker is not a completed or failed render.
export async function wakeWorker(payload, token) {
  try {
    const response = await fetch((process.env.MEDIA_WORKER_URL || "https://alpha-ai-media-worker.onrender.com").replace(/\/$/,"") + "/process",{
      method:"POST",headers:{"content-type":"application/json",authorization:"Bearer " + token,
        ...(process.env.MEDIA_WORKER_SECRET ? {"x-worker-secret":process.env.MEDIA_WORKER_SECRET} : {})},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(10000),cache:"no-store"
    });
    const body = await response.json().catch(()=>({}));
    return response.ok ? null : body.error || `Worker returned HTTP ${response.status}. Job remains queued.`;
  } catch (error) { return `Job saved; worker has not acknowledged it yet: ${error.message}`; }
}
export function workflowError(error) {
  console.error("video workflow",error);
  const headers = error.retryAfter ? {"Retry-After": String(error.retryAfter)} : undefined;
  return Response.json({error:error.message || "Video workflow failed."},{status:error.status || 500,headers});
}

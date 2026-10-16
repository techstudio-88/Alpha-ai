import {createClient} from "@supabase/supabase-js";
import {createHash} from "node:crypto";
import {UUID} from "./video-workflow.mjs";

export function problem(message, status = 400) { return Object.assign(new Error(message), {status}); }
export function checked(result) { if (result.error) throw problem(result.error.message,500); return result.data; }
export async function enforceApiRateLimit(admin, identity, route, limit = 120, windowSeconds = 60) {
  const keyHash = createHash("sha256").update(String(identity || "")).digest("hex");
  const result = checked(await admin.rpc("consume_api_rate_limit", {
    p_key_hash: keyHash,
    p_route: String(route || "/unknown").slice(0, 200),
    p_limit: limit,
    p_window_seconds: windowSeconds
  }));
  const state = Array.isArray(result) ? result[0] : result;
  if (!state?.allowed) {
    throw Object.assign(problem("Too many requests. Please wait a moment and try again.", 429), {
      retryAfter: Math.max(1, Number(state?.retryAfter) || windowSeconds)
    });
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
  const limit = route === "/api/ai/chat/plan" ? 8
    : route.startsWith("/api/ai/") || route === "/api/assistant" ? 20
    : route.startsWith("/api/editor/") ? 30
    : 120;
  await enforceApiRateLimit(admin, data.user.id, route, limit, 60);
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

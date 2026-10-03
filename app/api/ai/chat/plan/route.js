import {authorizeWorkflow,checked,mediaContext,problem,wakeWorker,workflowError} from "../../../../../lib/workflow-server";
import {UUID} from "../../../../../lib/video-workflow.mjs";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request) {
  try {
    const body = await request.json();
    const {workspaceId,projectId,mediaAssetId,sessionId,requestId,clipId,sourceId} = body;
    const prompt = String(body.prompt || "").trim();
    if (!prompt || prompt.length > 6000 || !UUID.test(sessionId || "") || !UUID.test(requestId || ""))
      throw problem("A chat, request ID and instruction (up to 6,000 characters) are required.");
    const {admin,user,token} = await authorizeWorkflow(request,workspaceId);
    const {asset} = await mediaContext(admin,workspaceId,projectId,mediaAssetId);
    let source;
    if (sourceId) {
      source = checked(await admin.from("project_sources").select("*").eq("id",sourceId).eq("project_id",projectId).maybeSingle());
      if (!source) throw problem("Source not found.",404);
    }
    if (!asset && !source) throw problem("Attach a video first.");
    if (asset?.status === "uploading") throw problem("Finish uploading this video before sending.",409);
    if (clipId) {
      const clip = checked(await admin.from("clips").select("id").eq("id",clipId).eq("project_id",projectId).eq("media_asset_id",mediaAssetId).maybeSingle());
      if (!clip) throw problem("Clip not found for this video.",404);
    }
    const transcript = asset && checked(await admin.from("transcripts").select("id,status").eq("media_asset_id",asset.id).eq("status","completed").order("created_at",{ascending:false}).limit(1).maybeSingle());
    const payload = {operation:transcript ? "ai_chat_plan" : "chat_ingest",workspaceId,projectId,
      mediaAssetId:asset?.id || null,sourceId:source?.id || null,
      sourceType:asset ? "upload" : source.source_type,url:asset ? null : source.source_url,
      sessionId,requestId,clipId:clipId || null,prompt,requestedBy:user.id};
    const job = checked(await admin.rpc("submit_ai_chat_job",{p_id:requestId,p_session:sessionId,
      p_workspace:workspaceId,p_user:user.id,p_project:projectId,p_asset:asset?.id || null,p_prompt:prompt,p_payload:payload}));
    const warning = await wakeWorker({...payload,jobId:job.id},token);
    return Response.json({sessionId,jobId:job.id,warning},{status:202});
  } catch (error) { return workflowError(error); }
}

import {authorizeWorkflow,checked,problem,workflowError} from "../../../../../lib/workflow-server";
import {sourceUrl,UUID} from "../../../../../lib/video-workflow.mjs";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const {workspaceId,sessionId} = body;
    if (!UUID.test(sessionId || "")) throw problem("A valid chat is required.");
    const {admin,user} = await authorizeWorkflow(request,workspaceId);
    const existing = checked(await admin.from("ai_chat_sessions").select("id,workspace_id,user_id").eq("id",sessionId).maybeSingle());
    if (existing && (existing.workspace_id !== workspaceId || existing.user_id !== user.id)) throw problem("Chat access denied.",403);
    const name = String(body.name || "Linked video").slice(0,180);
    const remote = body.url ? sourceUrl(body.url) : null;
    if (!remote && (!Number.isFinite(body.size) || body.size <= 0 || body.size > 5 * 1024 ** 3 || !/\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name)))
      throw problem("Choose a supported video file up to 5 GB.");
    const project = checked(await admin.from("projects").insert({workspace_id:workspaceId,owner_id:user.id,name,status:"uploading"}).select().single());
    let asset = null;
    if (!remote) {
      const storagePath = `${workspaceId}/${project.id}/${crypto.randomUUID()}-${name.replace(/[^a-z\d._-]/gi,"-")}`;
      asset = checked(await admin.from("media_assets").insert({workspace_id:workspaceId,project_id:project.id,owner_id:user.id,name,
        storage_path:storagePath,mime_type:String(body.mimeType || "video/mp4"),size_bytes:body.size,status:"uploading"}).select().single());
      checked(await admin.from("videos").insert({project_id:project.id,media_asset_id:asset.id,title:name,status:"uploading"}));
    }
    const source = checked(await admin.from("project_sources").insert({workspace_id:workspaceId,project_id:project.id,
      source_type:remote?.sourceType || "upload",source_url:remote?.url || null,file_name:name,status:remote ? "queued" : "uploading"}).select().single());
    const session = {workspace_id:workspaceId,user_id:user.id,title:name,project_id:project.id,media_asset_id:asset?.id || null,updated_at:new Date().toISOString()};
    checked(existing ? await admin.from("ai_chat_sessions").update(session).eq("id",sessionId) : await admin.from("ai_chat_sessions").insert({id:sessionId,...session}));
    checked(await admin.from("ai_chat_messages").insert({session_id:sessionId,workspace_id:workspaceId,user_id:user.id,role:"system",
      content:remote ? "Video URL attached. Send instructions to start importing and analyzing it." : "Upload prepared. Waiting for the video bytes.",
      metadata:{sourceId:source.id,mediaAssetId:asset?.id || null,projectId:project.id}}));
    return Response.json({project,asset,source,sessionId});
  } catch (error) { return workflowError(error); }
}

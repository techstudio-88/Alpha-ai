import { createClient } from "@supabase/supabase-js";
import { cronAuthorized } from "../../../../lib/cron-auth.mjs";

export const runtime = "nodejs";

const getAdmin = () =>
  createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false } }
  );

export async function GET(request) {
  if (!cronAuthorized(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const admin = getAdmin();
  const nowIso = new Date().toISOString();
  const warnThreshold = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  let bytesFreed = 0;
  let deletedArchives = 0;
  let deletedMedia = 0;
  let deletedClips = 0;
  let warnedCount = 0;

  try {
    // 1. 24h Warning notice: find media_assets nearing expiration without prior warning
    const { data: nearingMedia } = await admin
      .from("media_assets")
      .select("id, workspace_id, expires_at, deletion_warning_sent_at")
      .gt("expires_at", nowIso)
      .lte("expires_at", warnThreshold)
      .is("deletion_warning_sent_at", null)
      .limit(100);

    if (nearingMedia && nearingMedia.length > 0) {
      for (const asset of nearingMedia) {
        await admin
          .from("media_assets")
          .update({ deletion_warning_sent_at: nowIso })
          .eq("id", asset.id);
        warnedCount++;
      }
    }

    // 2. Expired export archives cleanup
    const { data: expiredArchives } = await admin
      .from("export_archives")
      .select("id, workspace_id, storage_path, file_size_bytes")
      .lte("expires_at", nowIso)
      .limit(50);

    if (expiredArchives && expiredArchives.length > 0) {
      for (const arch of expiredArchives) {
        if (arch.storage_path) {
          await admin.storage.from("media").remove([arch.storage_path]).catch(() => {});
        }
        const size = Number(arch.file_size_bytes || 0);
        bytesFreed += size;
        await admin.from("storage_deletion_logs").insert({
          workspace_id: arch.workspace_id,
          file_path: arch.storage_path,
          entity_type: "zip",
          bytes_freed: size,
          reason: "retention_policy_7d",
          deleted_at: nowIso,
        }).catch(() => {});
        await admin.from("export_archives").delete().eq("id", arch.id).catch(() => {});
        deletedArchives++;
      }
    }

    // 3. Expired clip versions
    const { data: expiredClips } = await admin
      .from("clip_versions")
      .select("id, clip_id, storage_path, expires_at")
      .lte("expires_at", nowIso)
      .neq("render_status", "expired")
      .limit(50);

    if (expiredClips && expiredClips.length > 0) {
      for (const clipVer of expiredClips) {
        if (clipVer.storage_path) {
          await admin.storage.from("media").remove([clipVer.storage_path]).catch(() => {});
          await admin.from("storage_deletion_logs").insert({
            workspace_id: null,
            file_path: clipVer.storage_path,
            entity_type: "clip",
            bytes_freed: 0,
            reason: "retention_policy",
            deleted_at: nowIso,
          }).catch(() => {});
        }
        await admin
          .from("clip_versions")
          .update({ render_status: "expired", storage_path: null })
          .eq("id", clipVer.id)
          .catch(() => {});
        deletedClips++;
      }
    }

    // 4. Expired media assets (raw uploads)
    const { data: expiredMedia } = await admin
      .from("media_assets")
      .select("id, workspace_id, storage_path, size_bytes, expires_at")
      .lte("expires_at", nowIso)
      .neq("status", "expired")
      .limit(50);

    if (expiredMedia && expiredMedia.length > 0) {
      for (const asset of expiredMedia) {
        if (asset.storage_path) {
          await admin.storage.from("media").remove([asset.storage_path]).catch(() => {});
        }
        const size = Number(asset.size_bytes || 0);
        bytesFreed += size;
        await admin.from("storage_deletion_logs").insert({
          workspace_id: asset.workspace_id,
          file_path: asset.storage_path,
          entity_type: "upload",
          bytes_freed: size,
          reason: "retention_policy",
          deleted_at: nowIso,
        }).catch(() => {});
        await admin
          .from("media_assets")
          .update({ status: "expired" })
          .eq("id", asset.id)
          .catch(() => {});
        deletedMedia++;
      }
    }

    return Response.json({
      ok: true,
      deleted: {
        archives: deletedArchives,
        clips: deletedClips,
        media: deletedMedia,
        bytesFreed,
      },
      warned: warnedCount,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}

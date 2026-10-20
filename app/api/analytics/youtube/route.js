import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { decryptCredential, encryptCredential } from "../../../../lib/credential-cipher.mjs";
import { enforceWorkspaceApiRateLimit } from "../../../../lib/workflow-server.js";

const service = () => createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);
const publicClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function googleFetch(url, accessToken) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error?.message || "YouTube analytics request failed."), { status: response.status });
  return body;
}

export async function POST(request) {
  try {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in to sync YouTube analytics." }, 401);
    const workspaceId = new URL(request.url).searchParams.get("workspace_id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId || "")) return json({ error: "A valid workspace is required." }, 400);

    const pub = publicClient();
    const { data: authData, error: authError } = await pub.auth.getUser(authorization.slice(7));
    if (authError || !authData.user) return json({ error: "Your session expired. Sign in again." }, 401);
    const { data: member } = await pub.from("workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", authData.user.id).maybeSingle();
    if (!member) return json({ error: "Workspace access denied." }, 403);

    const admin = service();
    const limit = await enforceWorkspaceApiRateLimit(admin, authData.user.id, workspaceId, "/api/analytics/youtube", 8, 60, request.headers.get("x-forwarded-for"));
    if (!limit.allowed) return json({ error: "Analytics sync is temporarily rate-limited. Try again shortly." }, 429);

    const workerSecret = process.env.MEDIA_WORKER_SECRET;
    if (!workerSecret) return json({ error: "Encrypted publishing credentials are not configured." }, 503);
    const { data: connection, error: connectionError } = await admin.from("publish_connections")
      .select("id,workspace_id,platform,access_token,refresh_token,expires_at,status")
      .eq("workspace_id", workspaceId).eq("platform", "youtube").eq("status", "connected").maybeSingle();
    if (connectionError) throw new Error("Could not load the YouTube connection.");
    if (!connection?.access_token) return json({ error: "Connect YouTube in Publish before syncing analytics." }, 409);

    let accessToken = decryptCredential(connection.access_token, workerSecret);
    if (!connection.expires_at || Date.parse(connection.expires_at) < Date.now() + 60000) {
      if (!connection.refresh_token || !process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) return json({ error: "Your YouTube connection needs to be reconnected." }, 409);
      const refreshToken = decryptCredential(connection.refresh_token, workerSecret);
      const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const refreshed = await refreshResponse.json().catch(() => ({}));
      if (!refreshResponse.ok || !refreshed.access_token) return json({ error: "YouTube authorization expired. Reconnect the channel and retry." }, 409);
      accessToken = refreshed.access_token;
      const update = await admin.from("publish_connections").update({
        access_token: encryptCredential(accessToken, workerSecret),
        expires_at: new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", connection.id);
      if (update.error) throw new Error("Could not renew the YouTube connection.");
    }

    const { data: posts, error: postsError } = await admin.from("posts")
      .select("id,workspace_id,clip_id,external_id,metadata")
      .eq("workspace_id", workspaceId).eq("platform", "youtube").eq("status", "published")
      .not("external_id", "is", null).limit(50);
    if (postsError) throw new Error("Could not load published YouTube posts.");
    const validPosts = (posts || []).filter(p => /^[A-Za-z0-9_-]{11}$/.test(String(p.external_id || "")));
    if (!validPosts.length) return json({ ok: true, synced: 0, message: "No published YouTube videos are available to sync yet." });

    const { data: recent, error: recentError } = await admin.from("content_performance")
      .select("post_id").eq("workspace_id", workspaceId).eq("platform", "youtube")
      .gte("captured_at", new Date(Date.now() - 15 * 60 * 1000).toISOString())
      .in("post_id", validPosts.map(post => post.id));
    if (recentError) throw new Error("Could not check recent analytics snapshots.");
    const recentIds = new Set((recent || []).map(row => row.post_id));
    const toSync = validPosts.filter(post => !recentIds.has(post.id));
    if (!toSync.length) return json({ ok: true, synced: 0, message: "YouTube metrics were synced recently. Try again in 15 minutes." });

    const ids = [...new Set(toSync.map(p => p.external_id))];
    const videos = await googleFetch("https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=" + ids.join(","), accessToken);
    const byId = new Map((videos.items || []).map(video => [video.id, video]));
    const capturedAt = new Date().toISOString();
    const snapshots = [];
    for (const post of toSync) {
      const video = byId.get(post.external_id);
      if (!video) continue;
      const stats = video.statistics || {};
      const number = key => Math.max(0, Number(stats[key]) || 0);
      snapshots.push({
        workspace_id: workspaceId,
        clip_id: post.clip_id || null,
        post_id: post.id,
        platform: "youtube",
        views: number("viewCount"),
        likes: number("likeCount"),
        comments: number("commentCount"),
        shares: 0,
        saves: 0,
        captured_at: capturedAt,
        metadata: { video_id: video.id, title: video.snippet?.title || "", source: "youtube_data_api" },
      });
    }
    if (snapshots.length) {
      const inserted = await admin.from("content_performance").insert(snapshots);
      if (inserted.error) throw new Error("YouTube metrics were retrieved but could not be saved.");
    }
    return json({ ok: true, synced: snapshots.length, captured_at: capturedAt });
  } catch (error) {
    const status = [400, 401, 403, 409, 429, 503].includes(error?.status) ? error.status : 500;
    return json({ error: status === 500 ? "YouTube analytics could not be synced. Please retry." : error.message, error_id: randomUUID() }, status);
  }
}

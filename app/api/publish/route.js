import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const db = () =>
  createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false } }
  );

async function user(req) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );
  const { data } = await c.auth.getUser(h.slice(7));
  return data.user || null;
}

export async function POST(req) {
  try {
    const u = await user(req);
    if (!u) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const b = await req.json();
    if (!b.clip_id || !b.platform) return Response.json({ error: "clip_id and platform required" }, { status: 400 });

    const platform = String(b.platform).toLowerCase();
    if (!["youtube", "instagram"].includes(platform)) {
      return Response.json({ error: "Supported platforms are 'youtube' and 'instagram'." }, { status: 400 });
    }

    const c = db();
    const { data: clip } = await c
      .from("clips")
      .select("id, project_id, title, start_seconds, end_seconds, ai_spec, clip_versions(*)")
      .eq("id", b.clip_id)
      .single();
    if (!clip) return Response.json({ error: "Clip not found" }, { status: 404 });

    const { data: p } = await c.from("projects").select("workspace_id").eq("id", clip.project_id).single();
    if (!p) return Response.json({ error: "Project not found" }, { status: 404 });

    const { data: m } = await c
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", p.workspace_id)
      .eq("user_id", u.id)
      .maybeSingle();
    if (!m) return Response.json({ error: "Workspace access denied" }, { status: 403 });

    // Validate video specs (aspect ratio 9:16, duration, size)
    const duration = Math.abs(Number(clip.end_seconds || 0) - Number(clip.start_seconds || 0));
    if (platform === "youtube" && duration > 60) {
      return Response.json({ error: "YouTube Shorts must be 60 seconds or shorter." }, { status: 400 });
    }
    if (platform === "instagram" && (duration < 3 || duration > 90)) {
      return Response.json({ error: "Instagram Reels must be between 3 and 90 seconds." }, { status: 400 });
    }

    const readyVersion = (clip.clip_versions || [])
      .filter(v => v.render_status === "ready" && v.storage_path)
      .sort((a, b) => b.version - a.version)[0];
    if (!readyVersion) {
      return Response.json({ error: "Render a ready version of this clip before publishing." }, { status: 409 });
    }

    // Verify connected account
    const { data: connection } = await c
      .from("publish_connections")
      .select("id, status")
      .eq("workspace_id", p.workspace_id)
      .eq("platform", platform)
      .eq("status", "connected")
      .maybeSingle();

    if (!connection) {
      return Response.json({ error: `Please connect your ${platform === "youtube" ? "YouTube" : "Instagram"} account before scheduling.` }, { status: 400 });
    }

    const { data: entitlement, error: entitlementError } = await c
      .from("workspace_entitlements")
      .select("scheduling_enabled, auto_publish")
      .eq("workspace_id", p.workspace_id)
      .maybeSingle();
    if (entitlementError) throw entitlementError;

    const scheduledFor = b.scheduled_for ? new Date(b.scheduled_for) : new Date();
    if (!Number.isFinite(scheduledFor.getTime())) return Response.json({ error: "Invalid scheduled_for date" }, { status: 400 });

    if (b.auto_publish && !entitlement?.auto_publish) {
      return Response.json({ error: "Automatic publishing is not included in your plan." }, { status: 402 });
    }
    if (b.scheduled_for && scheduledFor.getTime() > Date.now() + 60000 && !entitlement?.scheduling_enabled) {
      return Response.json({ error: "Scheduling is not included in your plan." }, { status: 402 });
    }

    const { data: j, error } = await c
      .from("publish_jobs")
      .insert({
        workspace_id: p.workspace_id,
        user_id: u.id,
        clip_id: b.clip_id,
        platform,
        status: "queued",
        scheduled_for: scheduledFor.toISOString(),
        metadata: {
          title: String(b.title || clip.title || "").slice(0, 100),
          description: String(b.description || b.caption || "").slice(0, platform === "youtube" ? 5000 : 2200),
          privacy: b.privacy || "private",
          auto_publish: Boolean(b.auto_publish),
          hashtags: Array.isArray(b.hashtags) ? b.hashtags : []
        },
      })
      .select("*")
      .single();

    if (error) throw error;
    return Response.json(j);
  } catch (e) {
    const message = String(e?.message || "Publish failed");
    return Response.json(
      {
        error: /SCHEDULING_NOT_INCLUDED_IN_PLAN/.test(message)
          ? "Scheduling is not included in your plan."
          : /AUTO_PUBLISH_NOT_INCLUDED_IN_PLAN/.test(message)
          ? "Automatic publishing is not included in your plan."
          : message,
      },
      { status: /SCHEDULING_NOT_INCLUDED_IN_PLAN|AUTO_PUBLISH_NOT_INCLUDED_IN_PLAN/.test(message) ? 402 : 500 }
    );
  }
}

export async function GET(req) {
  const u = await user(req);
  if (!u) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await db()
    .from("publish_jobs")
    .select("*")
    .eq("user_id", u.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data || []);
}

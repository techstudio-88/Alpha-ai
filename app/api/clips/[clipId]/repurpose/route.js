import { createClient } from "@supabase/supabase-js";
import { reserveWorkspaceFeatureUsage, finishWorkspaceFeatureUsage } from "../../../../../lib/workflow-server";

export const runtime = "nodejs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const worker = (process.env.MEDIA_WORKER_URL || "https://alpha-ai-media-worker.onrender.com").replace(/\/$/, "");
const secret = process.env.MEDIA_WORKER_SECRET || "";

// Transcript-only fallback keeps SEO tools useful when the optional remote worker is offline.
function transcriptSeoFallback(clipTitle, transcript) {
  const clean = String(transcript || "").replace(/\s+/g, " ").trim();
  const firstSentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  const titleSeed = String(clipTitle || firstSentence || "Video highlights").replace(/\s+/g, " ").trim();
  const title = (titleSeed.length > 86 ? titleSeed.slice(0, 83).replace(/\s+\S*$/, "") + "…" : titleSeed) || "Video highlights";
  const hook = (firstSentence || title).slice(0, 240);
  const caption = clean.slice(0, 1700);
  const stop = new Set("the a an and or but if then so to of in on for with from by is are was were be been being this that these those it its as at we you your our they their i me my he she them have has had do does did not no yes can could would should about into over after before what when why how who which".split(" "));
  const counts = new Map();
  for (const word of clean.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []) if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  const hashtags = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([word])=>"#"+word);
  for (const tag of ["#shorts","#reels"]) if (!hashtags.includes(tag) && hashtags.length < 8) hashtags.push(tag);
  const social = caption ? caption + "\n\nWhat part stood out to you?" : hook;
  return {hook,title,caption:social.slice(0,2200),hashtags,youtube_description:(caption+"\n\nWatch more clips and subscribe for the next one.").slice(0,5000),instagram_caption:social.slice(0,2200),tiktok_caption:social.slice(0,2200),linkedin_caption:caption.slice(0,3000),thumbnail_prompt:"Create a clear, high-contrast thumbnail based on this transcript without adding unsupported claims: "+hook.slice(0,300),_source:"transcript-fallback"};
}

async function auth(req) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  return (await c.auth.getUser(h.slice(7))).data.user || null;
}

export async function GET(req, { params }) {
  const user = await auth(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { clipId } = await params;
  const svc = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: clip } = await svc.from("clips").select("id,project_id").eq("id", clipId).maybeSingle();
  if (!clip) return Response.json({ error: "Clip not found" }, { status: 404 });

  const { data: project } = await svc.from("projects").select("workspace_id").eq("id", clip.project_id).maybeSingle();
  const { data: member } = project
    ? await svc.from("workspace_members").select("role").eq("workspace_id", project.workspace_id).eq("user_id", user.id).maybeSingle()
    : { data: null };
  if (!member) return Response.json({ error: "Workspace access denied" }, { status: 403 });

  const { data: ent } = await svc.from("workspace_entitlements").select("plan,title_regenerations,cover_rotations").eq("workspace_id", project.workspace_id).maybeSingle();
  const plan = ent?.plan || "free";
  const maxTitleRegens = plan === "studio" ? 999999 : plan === "pro" ? 30 : 3;
  const maxCoverRotations = plan === "studio" ? 999999 : plan === "pro" ? 10 : 1;

  // Check today's usage count
  const today = new Date().toISOString().slice(0, 10);
  const { count: titleRegenCount } = await svc
    .from("workspace_feature_usage")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", project.workspace_id)
    .eq("feature_key", "title_regeneration")
    .eq("status", "finalized")
    .gte("created_at", today);

  const { count: coverCount } = await svc
    .from("workspace_feature_usage")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", project.workspace_id)
    .eq("feature_key", "cover_rotation")
    .eq("status", "finalized")
    .gte("created_at", today);

  const { data, error } = await svc.from("clip_repurpose_assets").select("*").eq("clip_id", clipId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const remainingTitle = Math.max(0, maxTitleRegens - (titleRegenCount || 0));
  const remainingCover = Math.max(0, maxCoverRotations - (coverCount || 0));

  return Response.json({
    asset: data || null,
    plan,
    limits: {
      titleRegenerations: {
        max: maxTitleRegens,
        used: titleRegenCount || 0,
        remaining: remainingTitle,
        display: `${remainingTitle} of ${maxTitleRegens} left`
      },
      coverRotations: {
        max: maxCoverRotations,
        used: coverCount || 0,
        remaining: remainingCover,
        display: `${remainingCover} of ${maxCoverRotations} left`
      }
    }
  });
}

// Debounced autosave endpoint
export async function PATCH(req, { params }) {
  try {
    const user = await auth(req);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { clipId } = await params;
    const svc = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: clip } = await svc.from("clips").select("id,project_id").eq("id", clipId).maybeSingle();
    if (!clip) return Response.json({ error: "Clip not found" }, { status: 404 });

    const { data: project } = await svc.from("projects").select("workspace_id").eq("id", clip.project_id).maybeSingle();
    const { data: member } = project
      ? await svc.from("workspace_members").select("role").eq("workspace_id", project.workspace_id).eq("user_id", user.id).maybeSingle()
      : { data: null };
    if (!member) return Response.json({ error: "Workspace access denied" }, { status: 403 });

    const body = await req.json();
    const update = {
      workspace_id: project.workspace_id,
      clip_id: clip.id,
      updated_at: new Date().toISOString()
    };
    if (body.title !== undefined) update.title = String(body.title).slice(0, 180);
    if (body.hook !== undefined) update.hook = String(body.hook).slice(0, 500);
    if (body.caption !== undefined) update.caption = String(body.caption).slice(0, 3000);
    if (body.social_copy !== undefined) update.social_copy = body.social_copy;
    if (body.hashtags !== undefined) update.hashtags = Array.isArray(body.hashtags) ? body.hashtags : [];

    const { data: saved, error } = await svc.from("clip_repurpose_assets").upsert(update, { onConflict: "clip_id" }).select("*").single();
    if (error) throw error;
    return Response.json({ ok: true, asset: saved });
  } catch (e) {
    return Response.json({ error: e.message || "Autosave failed" }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  let usageReservation = null;
  const svc = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const user = await auth(req);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    const { clipId } = await params;

    const { data: clip } = await svc.from("clips").select("id,title,project_id,media_asset_id,start_seconds,end_seconds,ai_spec").eq("id", clipId).maybeSingle();
    if (!clip) return Response.json({ error: "Clip not found." }, { status: 404 });

    const { data: project } = await svc.from("projects").select("workspace_id").eq("id", clip.project_id).maybeSingle();
    const { data: member } = project
      ? await svc.from("workspace_members").select("role").eq("workspace_id", project.workspace_id).eq("user_id", user.id).maybeSingle()
      : { data: null };
    if (!member) return Response.json({ error: "Workspace access denied." }, { status: 403 });

    const body = await req.json().catch(() => ({}));

    // If manual save request
    if (body.autosave) {
      const row = {
        workspace_id: project.workspace_id,
        clip_id: clip.id,
        hook: String(body.hook || "").slice(0, 500),
        title: String(body.title || clip.title || "").slice(0, 180),
        caption: String(body.caption || "").slice(0, 3000),
        social_copy: body.social_copy || {},
        hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
        updated_at: new Date().toISOString()
      };
      const { data: saved, error } = await svc.from("clip_repurpose_assets").upsert(row, { onConflict: "clip_id" }).select("*").single();
      if (error) throw error;
      return Response.json({ ok: true, asset: saved });
    }

    // Server-side enforcement of title regeneration quota (Free: 3 max)
    const featureKey = body.feature === "cover_rotation" ? "cover_rotation" : "title_regeneration";
    const requestId = crypto.randomUUID();
    usageReservation = await reserveWorkspaceFeatureUsage(svc, project.workspace_id, user.id, featureKey, requestId);

    const { data: tr } = await svc.from("transcripts").select("id").eq("media_asset_id", clip.media_asset_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    let text = "";
    if (tr?.id) {
      const { data: seg } = await svc
        .from("transcript_segments")
        .select("start_ms,end_ms,text")
        .eq("transcript_id", tr.id)
        .lt("start_ms", Math.round(Number(clip.end_seconds) * 1000))
        .gt("end_ms", Math.round(Number(clip.start_seconds) * 1000))
        .order("start_ms", { ascending: true })
        .limit(300);
      text = (seg || []).map(x => x.text).join(" ").trim();
    }
    if (!text) text = String(clip.ai_spec?.summary || "").trim();
    if (!text) throw new Error("No transcript context is available for this clip. Finish transcription before generating SEO copy.");

    const prompt =
      "Create repurposing assets for this real short-form clip. Return ONLY valid JSON with keys hook,title,caption,hashtags,youtube_description,instagram_caption,tiktok_caption,linkedin_caption,thumbnail_prompt. Do not invent facts. YouTube title must be under 100 characters. Instagram caption must be under 2200 characters. 5-10 hashtags. Clip title: " +
      JSON.stringify(clip.title || "") +
      "\nTranscript:\n" +
      text.slice(0, 12000);

    let data;
    if (secret) {
      try {
        const wr = await fetch(worker + "/assistant", {
          method: "POST",
          headers: { "content-type": "application/json", "x-worker-secret": secret },
          body: JSON.stringify({ prompt, context: "Alpha.ai clip repurposing request" }),
          signal: AbortSignal.timeout(18000)
        });
        const wo = await wr.json().catch(() => ({}));
        if (!wr.ok) throw new Error(wo.error || "Remote SEO generation failed.");
        const raw = String(wo.text || "").match(/\{[\s\S]*\}/)?.[0];
        if (!raw) throw new Error("AI returned no structured repurposing package.");
        data = JSON.parse(raw);
      } catch {
        data = transcriptSeoFallback(clip.title, text);
      }
    } else {
      data = transcriptSeoFallback(clip.title, text);
    }

    const row = {
      workspace_id: project.workspace_id,
      clip_id: clip.id,
      hook: String(data.hook || "").slice(0, 500),
      title: String(data.title || clip.title || "").slice(0, 100),
      caption: String(data.caption || data.instagram_caption || "").slice(0, 2200),
      social_copy: {
        youtube: String(data.youtube_description || "").slice(0, 5000),
        instagram: String(data.instagram_caption || data.caption || "").slice(0, 2200),
        tiktok: String(data.tiktok_caption || "").slice(0, 2200),
        linkedin: String(data.linkedin_caption || "").slice(0, 3000),
      },
      hashtags: Array.isArray(data.hashtags) ? data.hashtags.slice(0, 15) : [],
      thumbnail_prompt: String(data.thumbnail_prompt || "").slice(0, 2000),
      model_version: data._source || process.env.GEMINI_MODEL || "gemini-2.5-flash",
      updated_at: new Date().toISOString()
    };

    const { data: saved, error } = await svc.from("clip_repurpose_assets").upsert(row, { onConflict: "clip_id" }).select("*").single();
    if (error) throw new Error(error.message);

    await finishWorkspaceFeatureUsage(svc, usageReservation.id, true);

    const remaining = Math.max(0, Number(usageReservation.remaining || 0) - 1);

    return Response.json({
      ok: true,
      asset: saved,
      remaining,
      message: `${remaining} of 3 left`
    });
  } catch (e) {
    if (usageReservation?.id) {
      await finishWorkspaceFeatureUsage(svc, usageReservation.id, false).catch(() => {});
    }
    console.error("clip repurpose error:", e);
    const message = e.message || "Repurposing failed.";
    const status = /limit reached|Upgrade your plan/i.test(message) ? 402 : 500;
    return Response.json({ error: message, error_id: crypto.randomUUID() }, { status });
  }
}

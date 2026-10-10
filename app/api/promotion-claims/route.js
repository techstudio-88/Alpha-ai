import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const PLATFORMS = new Set(["youtube", "instagram"]);

function admin() {
  if (!url || !service) throw Object.assign(new Error("Supabase server credentials are not configured."), { status: 503 });
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function userFor(request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ") || !url || !anon) return null;
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(header.slice(7));
  return error ? null : data.user || null;
}

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function value(input, max = 300) { return String(input ?? "").trim().slice(0, max); }
function isDuplicate(error) { return error?.code === "23505" || /duplicate|unique/i.test(error?.message || ""); }

function socialUrl(raw, platform) {
  let parsed;
  try { parsed = new URL(raw); } catch { fail("post_url must be a valid HTTPS URL"); }
  if (parsed.protocol !== "https:") fail("post_url must use HTTPS");
  if (parsed.username || parsed.password) fail("post_url must not contain credentials");
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const allowed = platform === "youtube"
    ? (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com"))
    : (host === "instagram.com" || host.endsWith(".instagram.com"));
  if (!allowed) fail(`post_url is not a ${platform} URL`);
  parsed.hash = "";
  parsed.search = "";
  parsed.hostname = host;
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return parsed.toString();
}

function dedupeKey(platform, canonicalUrl, externalId) {
  const identity = externalId ? `id:${platform}:${externalId.toLowerCase()}` : `url:${canonicalUrl}`;
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function rewardAmount() {
  const configured = Number.parseInt(process.env.ALPHA_PROMOTION_REWARD_TOKENS || "10", 10);
  return Number.isFinite(configured) ? Math.max(1, Math.min(100, configured)) : 10;
}

async function assertWorkspaceContent(client, workspaceId, userId, clipId, projectId) {
  const member = await client.from("workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (member.error) throw member.error;
  if (!member.data) fail("Workspace access denied", 403);
  if (projectId) {
    const project = await client.from("projects").select("id,workspace_id").eq("id", projectId).maybeSingle();
    if (project.error) throw project.error;
    if (!project.data || project.data.workspace_id !== workspaceId) fail("Project not found in this workspace", 404);
  }
  if (clipId) {
    const clip = await client.from("clips").select("id,project_id").eq("id", clipId).maybeSingle();
    if (clip.error) throw clip.error;
    if (!clip.data) fail("Clip not found", 404);
    const project = await client.from("projects").select("id,workspace_id").eq("id", clip.data.project_id).maybeSingle();
    if (project.error) throw project.error;
    if (!project.data || project.data.workspace_id !== workspaceId) fail("Clip not found in this workspace", 404);
    if (projectId && project.data.id !== projectId) fail("clip_id and project_id do not match", 400);
  }
}

export async function POST(request) {
  try {
    const user = await userFor(request);
    if (!user) fail("Unauthorized", 401);
    const body = await request.json().catch(() => ({}));
    const workspaceId = value(body.workspace_id, 100);
    const platform = value(body.platform, 30).toLowerCase();
    const claimType = value(body.claim_type || "reel_tag", 30).toLowerCase();
    const postInput = value(body.post_url || body.proof_url || body.bio_url, 2000);
    const externalId = value(body.external_post_id, 300) || null;
    const clipId = value(body.clip_id, 100) || null;
    const projectId = value(body.project_id, 100) || null;
    if (!workspaceId || !platform || !postInput) fail("workspace_id, platform, and proof URL are required");
    if (!PLATFORMS.has(platform)) fail("platform must be youtube or instagram");
    if (!["reel_tag","profile_bio"].includes(claimType)) fail("claim_type must be reel_tag or profile_bio");
    const postUrl = socialUrl(postInput, platform);
    const client = admin();
    await assertWorkspaceContent(client, workspaceId, user.id, clipId, projectId);
    const claim = {
      workspace_id: workspaceId,
      user_id: user.id,
      clip_id: clipId,
      project_id: projectId,
      platform,
      claim_type: claimType,
      post_url: postUrl,
      external_post_id: externalId,
      dedupe_key: dedupeKey(platform, postUrl, externalId),
      reward_tokens: rewardAmount(),
      metadata: { source: "promotion_claim_api", verification: "manual_review_required" },
    };
    const inserted = await client.from("promotion_claims").insert(claim).select("*").single();
    if (inserted.error) {
      if (isDuplicate(inserted.error)) return Response.json({ error: "This promotion has already been claimed for this workspace and platform." }, { status: 409 });
      throw inserted.error;
    }
    const ledger = await client.from("token_ledger").select("id,amount,entry_type,status,reason,reference_type,reference_id,created_at").eq("reference_type", "promotion_claim").eq("reference_id", inserted.data.id).maybeSingle();
    if (ledger.error) throw ledger.error;
    return Response.json({ claim: inserted.data, token_entry: ledger.data || null, note: "Claim submitted for manual review; social publication was not automatically verified." }, { status: 201 });
  } catch (error) {
    console.error("promotion claim submission", error);
    return Response.json({ error: error.message || "Promotion claim failed" }, { status: error.status || 500 });
  }
}

export async function GET(request) {
  try {
    const user = await userFor(request);
    if (!user) fail("Unauthorized", 401);
    const params = new URL(request.url).searchParams;
    const workspaceId = value(params.get("workspace_id"), 100) || null;
    const client = admin();
    let query = client.from("promotion_claims").select("id,workspace_id,user_id,clip_id,project_id,platform,claim_type,post_url,external_post_id,reward_tokens,status,reviewer_note,submitted_at,reviewed_at,metadata").eq("user_id", user.id).order("submitted_at", { ascending: false }).limit(100);
    if (workspaceId) {
      const member = await client.from("workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
      if (member.error) throw member.error;
      if (!member.data) fail("Workspace access denied", 403);
      query = query.eq("workspace_id", workspaceId);
    }
    const result = await query;
    if (result.error) throw result.error;
    const claims = result.data || [];
    const ids = claims.map((claim) => claim.id);
    let ledger = [];
    if (ids.length) {
      const entries = await client.from("token_ledger").select("id,amount,entry_type,status,reason,reference_type,reference_id,created_at").eq("reference_type", "promotion_claim").in("reference_id", ids);
      if (entries.error) throw entries.error;
      ledger = entries.data || [];
    }
    const byClaim = new Map(ledger.map((entry) => [entry.reference_id, entry]));
    return Response.json({ claims: claims.map((claim) => ({ ...claim, token_entry: byClaim.get(claim.id) || null })) });
  } catch (error) {
    console.error("promotion claim listing", error);
    return Response.json({ error: error.message || "Promotion claims could not be loaded" }, { status: error.status || 500 });
  }
}

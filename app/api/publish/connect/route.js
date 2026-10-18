import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const db = () =>
  createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false } }
  );

function secret() {
  const s = process.env.OAUTH_STATE_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error("OAuth state secret is not configured.");
  return s;
}

function sign(v) {
  return crypto.createHmac("sha256", secret()).update(v).digest("hex");
}

export async function POST(req) {
  try {
    const u = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const platform = (u.searchParams.get("platform") || body.platform || "youtube").toLowerCase();
    const workspace = u.searchParams.get("workspace_id") || body.workspace_id;
    const action = u.searchParams.get("action") || body.action || "connect";

    const h = req.headers.get("authorization") || "";
    if (!h.startsWith("Bearer ")) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const pub = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );
    const user = (await pub.auth.getUser(h.slice(7))).data.user;
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    if (!workspace) return Response.json({ error: "workspace_id required" }, { status: 400 });

    const { data: member, error: memberError } = await pub
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", workspace)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberError || !member) return Response.json({ error: "Forbidden" }, { status: 403 });

    // Handle Disconnect action
    if (action === "disconnect") {
      await db()
        .from("publish_connections")
        .update({ status: "disconnected", access_token: null, refresh_token: null, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspace)
        .eq("platform", platform);
      return Response.json({ ok: true, message: `${platform} connection disconnected.` });
    }

    const now = Date.now();
    const statePayload = {
      workspace_id: workspace,
      user_id: user.id,
      platform,
      iat: now,
      exp: now + 10 * 60 * 1000,
      nonce: crypto.randomBytes(12).toString("hex"),
    };
    const stateStr = Buffer.from(JSON.stringify(statePayload)).toString("base64url");
    const signed = stateStr + "." + sign(stateStr);

    if (platform === "youtube") {
      const client = process.env.YOUTUBE_CLIENT_ID;
      if (!client) return Response.json({ error: "YOUTUBE_CLIENT_ID is not configured." }, { status: 503 });
      const redirect = process.env.YOUTUBE_REDIRECT_URI || new URL("/api/publish/callback", u.origin).toString();
      const params = new URLSearchParams({
        client_id: client,
        redirect_uri: redirect,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
        access_type: "offline",
        prompt: "consent",
        state: signed,
      });
      return Response.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString() });
    }

    if (platform === "instagram") {
      const client = process.env.INSTAGRAM_CLIENT_ID || process.env.META_CLIENT_ID;
      if (!client) return Response.json({ error: "INSTAGRAM_CLIENT_ID is not configured." }, { status: 503 });
      const redirect = process.env.INSTAGRAM_REDIRECT_URI || new URL("/api/publish/callback", u.origin).toString();
      const params = new URLSearchParams({
        client_id: client,
        redirect_uri: redirect,
        response_type: "code",
        scope: "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement",
        state: signed,
      });
      return Response.json({ url: "https://www.facebook.com/v19.0/dialog/oauth?" + params.toString() });
    }

    return Response.json({ error: "Unsupported platform. Use 'youtube' or 'instagram'." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || "Failed to initiate connector." }, { status: 500 });
  }
}

export async function DELETE(req) {
  const u = new URL(req.url);
  const platform = (u.searchParams.get("platform") || "youtube").toLowerCase();
  const workspace = u.searchParams.get("workspace_id");
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const pub = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );
  const user = (await pub.auth.getUser(h.slice(7))).data.user;
  if (!user || !workspace) return Response.json({ error: "Unauthorized" }, { status: 401 });

  await db()
    .from("publish_connections")
    .update({ status: "disconnected", access_token: null, refresh_token: null, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspace)
    .eq("platform", platform);

  return Response.json({ ok: true, platform, status: "disconnected" });
}

export async function GET() {
  return Response.json({ error: "POST or DELETE required." }, { status: 405 });
}
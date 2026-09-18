import { Webhook } from "npm:standardwebhooks@1";

type HookPayload = {
  user: { id: string; email?: string; new_email?: string; user_metadata?: { full_name?: string } };
  email_data: {
    token: string; token_hash: string; redirect_to: string; email_action_type: string;
    site_url: string; token_new?: string; token_hash_new?: string;
  };
};

const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET")?.replace(/^v1,whsec_/, "");
const appsScriptUrl = Deno.env.get("APPS_SCRIPT_URL");
const appsScriptSecret = Deno.env.get("APPS_SCRIPT_SECRET");

const escapeHtml = (value = "") => value.replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c] || c));

function buildEmail(payload: HookPayload, tokenHash: string, recipient: string) {
  const type = payload.email_data.email_action_type || "signup";
  const name = payload.user.user_metadata?.full_name?.trim() || "there";
  const redirect = payload.email_data.redirect_to || payload.email_data.site_url || "https://alpha-ai-techstudio7808-4455.vercel.app";
  const verificationUrl = `${redirect}${redirect.includes("?") ? "&" : "?"}token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`;
  const copy: Record<string, {subject:string; body:string; button:string}> = {
    signup:{subject:"Verify your Alpha.ai email",body:"Confirm your email address to activate your Alpha.ai account and start turning long videos into content that gets watched.",button:"Verify my email"},
    invite:{subject:"You’re invited to Alpha.ai",body:"You’ve been invited to join an Alpha.ai workspace. Confirm your email to continue.",button:"Accept invitation"},
    recovery:{subject:"Reset your Alpha.ai password",body:"Use the secure link below to choose a new Alpha.ai password. If you did not request this, you can ignore this email.",button:"Reset password"},
    magiclink:{subject:"Your Alpha.ai sign-in link",body:"Use the secure link below to sign in. This link is single-use.",button:"Sign in"},
    email_change:{subject:"Confirm your Alpha.ai email change",body:"Confirm this request to update the email address on your Alpha.ai account.",button:"Confirm email change"},
    reauthentication:{subject:"Confirm your Alpha.ai request",body:"Use the secure link below to confirm this action on your Alpha.ai account.",button:"Confirm"}
  };
  const c = copy[type] || copy.signup;
  const html = `<!doctype html><html><body style="margin:0;background:#07090f;font-family:Arial,sans-serif;color:#f5f7ff"><div style="max-width:620px;margin:0 auto;padding:44px 20px"><div style="border:1px solid #202635;border-radius:24px;background:#0d111a;padding:40px"><div style="font-size:24px;font-weight:800;margin-bottom:34px">Alpha<span style="color:#7c5cff">.ai</span></div><div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#8e99ae;margin-bottom:12px">SECURE ACCOUNT ACTION</div><h1 style="font-size:32px;line-height:1.1;margin:0 0 16px">Hello ${escapeHtml(name)},</h1><p style="font-size:16px;line-height:1.7;color:#b9c2d4;margin:0 0 28px">${escapeHtml(c.body)}</p><a href="${escapeHtml(verificationUrl)}" style="display:inline-block;padding:15px 22px;border-radius:12px;background:#7c5cff;color:#fff;text-decoration:none;font-weight:700">${escapeHtml(c.button)} →</a><p style="font-size:12px;line-height:1.6;color:#727d91;margin:28px 0 0">If the button does not work, copy and paste the link into your browser. For security, this link is time-limited.</p><div style="margin-top:34px;padding-top:22px;border-top:1px solid #202635;font-size:12px;color:#667085">© Alpha.ai · Turn Long Videos Into Content That Gets Watched.</div></div></div></body></html>`;
  return {to:recipient,subject:c.subject,html,text:`Alpha.ai\n\nHello ${name},\n\n${c.body}\n\n${c.button}: ${verificationUrl}`,action_type:type};
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed",{status:405});
  if (!hookSecret || !appsScriptUrl || !appsScriptSecret) return Response.json({error:"Email provider is not configured"},{status:500});
  const raw = await req.text();
  try {
    const payload = new Webhook(hookSecret).verify(raw,Object.fromEntries(req.headers)) as HookPayload;
    const d = payload.email_data;
    const recipient = payload.user.email || "";
    if (!recipient) return Response.json({error:"Recipient email missing"},{status:400});
    const messages = [];
    if (d.email_action_type === "email_change" && d.token_hash_new && payload.user.email && payload.user.new_email) {
      messages.push(buildEmail(payload,d.token_hash_new,payload.user.email));
      messages.push(buildEmail(payload,d.token_hash || d.token_hash_new,payload.user.new_email));
    } else {
      const hash = d.token_hash || d.token_hash_new;
      if (!hash) return Response.json({error:"Verification token missing"},{status:400});
      messages.push(buildEmail(payload,hash,recipient));
    }
    const provider = await fetch(appsScriptUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({secret:appsScriptSecret,messages})});
    if (!provider.ok) return Response.json({error:"Email provider failed"},{status:502});
    return new Response(JSON.stringify({}),{status:200,headers:{"Content-Type":"application/json"}});
  } catch (error) {
    console.error(error);
    return Response.json({error:"Invalid email hook request"},{status:401});
  }
});

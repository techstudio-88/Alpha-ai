export async function sendPreferenceEmail(admin, userId, event, subject, message) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from || !admin || !userId) return { sent: false, reason: 'email_not_configured' };
  const { data: profile, error: profileError } = await admin.from('profiles').select('preferences').eq('id', userId).maybeSingle();
  if (profileError) throw profileError;
  if (profile?.preferences?.notifications?.[event]?.email !== true) return { sent: false, reason: 'email_disabled_by_user' };
  const { data, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError) throw userError;
  const to = data?.user?.email;
  if (!to) return { sent: false, reason: 'email_missing' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text: message }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Email provider rejected the message (HTTP ' + response.status + ').');
  return { sent: true };
}

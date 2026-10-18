import {createClient} from '@supabase/supabase-js';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {encryptCredential} from '../../../../lib/credential-cipher.mjs';
import {requireWorkerCapability} from '../../../../lib/worker-capabilities';

export async function GET(request){
  try{
    const url=new URL(request.url),code=url.searchParams.get('code');
    const [state,signature]=(url.searchParams.get('state')||'').split('.');
    const stateSecret=process.env.OAUTH_STATE_SECRET||process.env.CRON_SECRET;
    const workerSecret=process.env.MEDIA_WORKER_SECRET;
    if(!stateSecret||!workerSecret)throw new Error('Publish connection credentials are not configured.');
    if(!code||!state||!/^[a-f\d]{64}$/i.test(signature||''))return Response.json({error:'Invalid OAuth state.'},{status:400});
    const expected=createHmac('sha256',stateSecret).update(state).digest();
    if(!timingSafeEqual(Buffer.from(signature,'hex'),expected))return Response.json({error:'Invalid OAuth state.'},{status:400});
    const context=JSON.parse(Buffer.from(state,'base64url').toString('utf8'));
    if(!context.workspace_id||!context.user_id||!context.exp||Date.now()>Number(context.exp))return Response.json({error:'OAuth state expired.'},{status:400});
    const service=createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
    const member=await service.from('workspace_members').select('workspace_id').eq('workspace_id',context.workspace_id).eq('user_id',context.user_id).maybeSingle();
    if(member.error||!member.data)return Response.json({error:'Workspace membership is no longer valid.'},{status:403});
    await requireWorkerCapability('encrypted-credentials');

    const platform = (context.platform || 'youtube').toLowerCase();

    if(platform === 'instagram'){
      const redirect = process.env.INSTAGRAM_REDIRECT_URI || new URL('/api/publish/callback', url.origin).toString();
      const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.INSTAGRAM_CLIENT_ID || process.env.META_CLIENT_ID || ''}&client_secret=${process.env.INSTAGRAM_CLIENT_SECRET || process.env.META_CLIENT_SECRET || ''}&redirect_uri=${encodeURIComponent(redirect)}&code=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(10000) });
      const token = await tokenRes.json();
      if(!tokenRes.ok || !token.access_token) throw new Error(token.error?.message || 'Instagram authorization could not finish.');

      // Exchange short-lived token for long-lived 60-day token
      const longLivedRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.INSTAGRAM_CLIENT_ID || process.env.META_CLIENT_ID || ''}&client_secret=${process.env.INSTAGRAM_CLIENT_SECRET || process.env.META_CLIENT_SECRET || ''}&fb_exchange_token=${token.access_token}`, { signal: AbortSignal.timeout(10000) });
      const longToken = await longLivedRes.json().catch(() => token);
      const accessToken = longToken.access_token || token.access_token;

      // Find Instagram Business Account connected to Page
      const accountsRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=name,instagram_business_account{id,username,name,profile_picture_url}&access_token=${accessToken}`, { signal: AbortSignal.timeout(10000) });
      const accounts = await accountsRes.json();
      const igAccount = accounts.data?.find(a => a.instagram_business_account)?.instagram_business_account;
      if(!igAccount?.id) throw new Error('No Instagram Business or Creator account found linked to this Meta account.');

      const result = await service.from('publish_connections').upsert({
        workspace_id: context.workspace_id,
        user_id: context.user_id,
        platform: 'instagram',
        provider_account_id: igAccount.id,
        account_name: igAccount.username || igAccount.name || 'Instagram Business',
        access_token: encryptCredential(accessToken, workerSecret),
        refresh_token: null,
        expires_at: new Date(Date.now() + Number(longToken.expires_in || 5184000) * 1000).toISOString(),
        scopes: ['instagram_basic', 'instagram_content_publish'],
        status: 'connected',
        metadata: { username: igAccount.username, profile_picture: igAccount.profile_picture_url || null },
        updated_at: new Date().toISOString()
      }, { onConflict: 'workspace_id,platform' });

      if(result.error) throw new Error('The Instagram connection could not be saved. Please retry.');
      return Response.redirect(new URL('/studio?view=publish&connected=instagram', url.origin));
    }

    // Default YouTube OAuth
    const redirect = process.env.YOUTUBE_REDIRECT_URI || new URL('/api/publish/callback', url.origin).toString();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.YOUTUBE_CLIENT_ID || '',
        client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
        redirect_uri: redirect,
        grant_type: 'authorization_code'
      }),
      signal: AbortSignal.timeout(10000)
    });
    const token = await response.json();
    if(!response.ok || !token.access_token) throw new Error('YouTube authorization could not finish. Reconnect the channel.');
    const channels = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: 'Bearer ' + token.access_token },
      signal: AbortSignal.timeout(10000)
    });
    const channel = (await channels.json())?.items?.[0];
    if(!channels.ok || !channel) throw new Error('This Google account has no accessible YouTube channel.');
    const old = await service.from('publish_connections').select('refresh_token').eq('workspace_id', context.workspace_id).eq('platform', 'youtube').maybeSingle();
    const refresh = token.refresh_token ? encryptCredential(token.refresh_token, workerSecret) : old.data?.refresh_token || null;
    const result = await service.from('publish_connections').upsert({
      workspace_id: context.workspace_id,
      user_id: context.user_id,
      platform: 'youtube',
      provider_account_id: channel.id,
      account_name: channel.snippet?.localized?.title || channel.snippet?.title || 'YouTube',
      access_token: encryptCredential(token.access_token, workerSecret),
      refresh_token: refresh,
      expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(),
      scopes: String(token.scope || '').split(' ').filter(Boolean),
      status: 'connected',
      metadata: { channel_thumbnail: channel.snippet?.thumbnails?.default?.url || null },
      updated_at: new Date().toISOString()
    }, { onConflict: 'workspace_id,platform' });
    if(result.error) throw new Error('The channel connection could not be saved. Please retry.');
    return Response.redirect(new URL('/studio?view=publish&connected=youtube', url.origin));
  }catch(error){
    return Response.json({error: error.message || 'Publish connector failed.'}, {status: 500});
  }
}

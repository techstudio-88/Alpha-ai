"use client";

import {useEffect,useRef,useState} from 'react';
import {Check,Loader2} from 'lucide-react';
import {supabase} from '../../../lib/supabase';
import Brand from '../../../components/studio/brand';
import {ButtonLink,ErrorState} from '../../../components/studio/ui';

export default function ConfirmEmailPage() {
  const verification=useRef(null);
  const [status,setStatus]=useState('loading');
  const [recovery,setRecovery]=useState(false);
  useEffect(()=>{
    let alive=true;
    if(!verification.current)verification.current=(async()=>{
      if(!supabase)throw new Error('Authentication unavailable.');
      const url=new URL(window.location.href),token=url.searchParams.get('token_hash'),type=url.searchParams.get('type')||'signup';
      if(token){
        if(!['signup','recovery','invite','email','email_change'].includes(type))throw new Error('Invalid verification type.');
        const {error}=await supabase.auth.verifyOtp({token_hash:token,type});
        if(error)throw error;
      } else {
        const {data,error}=await supabase.auth.getSession();
        if(error||!data.session)throw new Error('No verification session.');
      }
      window.history.replaceState({},'',window.location.pathname);
      return type==='recovery';
    })();
    verification.current.then(isRecovery=>{if(alive){setRecovery(isRecovery);setStatus('success')}}).catch(()=>{if(alive)setStatus('error')});
    return()=>{alive=false};
  },[]);
  return <main id="main-content" className="auth-form min-h-dvh"><section className="auth-form-inner" aria-live="polite">
    <Brand/>
    {status==='loading'?<><Loader2 size={28} className="animate-spin text-muted mt-8"/><h1>Checking your link.</h1><p>We’re finishing your account verification.</p></>:status==='success'?<><Check size={28} className="text-success mt-8"/><h1>{recovery?'Choose your next password.':'You’re all set.'}</h1><p>{recovery?'Your reset link is verified.':'Your email is verified. Your studio is ready.'}</p><ButtonLink href={recovery?'/auth/update-password':'/studio'}>{recovery?'Update password':'Open your studio'}</ButtonLink></>:<><h1>Let’s get a fresh link.</h1><ErrorState message="This verification link is missing or has expired. Sign in or request a new confirmation email." onRetry={()=>window.location.href='/studio'}/><ButtonLink href="/studio" variant="ghost" className="mt-5">Return to sign in</ButtonLink></>}
  </section></main>;
}

"use client";

import {useEffect,useState} from 'react';
import {Check,LockKeyhole} from 'lucide-react';
import {supabase} from '../../../lib/supabase';
import Brand from '../../../components/studio/brand';
import {Button,ButtonLink,ErrorState,Input,Skeleton} from '../../../components/studio/ui';

export default function UpdatePassword() {
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [done,setDone]=useState(false);
  useEffect(()=>{
    let alive=true;
    if(!supabase){setError('Password reset is not configured.');setReady(true);return}
    supabase.auth.getSession().then(({data,error})=>{
      if(!alive)return;
      if(error||!data.session)setError('This reset link has expired. Request a new link to continue.');
      setReady(true);
      if(data.session)window.history.replaceState({},'',window.location.pathname);
    }).catch(()=>{if(alive){setError('The reset link could not be verified. Please retry.');setReady(true)}});
    return()=>{alive=false};
  },[]);
  async function save(event) {
    event.preventDefault();setError('');
    if(password!==confirm)return setError('Your passwords do not match.');
    setBusy(true);
    try {
      const {error}=await supabase.auth.updateUser({password});
      if(error)throw error;
      await supabase.auth.signOut();setDone(true);
    }catch{setError('Your password could not be updated. Please retry or request a new link.')}
    finally{setBusy(false)}
  }
  return <main id="main-content" className="auth-form min-h-dvh">
    <div className="auth-form-inner">
      <Brand/>
      {done?<><Check className="text-success mt-8" size={32}/><h1>You’re ready to return.</h1><p>Your password has been updated.</p><ButtonLink href="/studio">Return to sign in</ButtonLink></>:<>
        <LockKeyhole size={24} className="text-muted mt-8"/>
        <h1>Choose a new password.</h1><p>Use at least eight characters and keep it unique to this account.</p>
        {!ready?<Skeleton className="h-48"/>:<form onSubmit={save}>
          <Input label="New password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/>
          <Input label="Confirm new password" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={e=>setConfirm(e.target.value)} required/>
          <Button variant="primary" type="submit" busy={busy}>Update password</Button>
        </form>}
        {error&&<div className="mt-5"><ErrorState message={error} onRetry={()=>setError('')}/></div>}
        <ButtonLink href="/studio?mode=reset" variant="ghost" className="mt-5">Request a new reset link</ButtonLink>
      </>}
    </div>
  </main>;
}

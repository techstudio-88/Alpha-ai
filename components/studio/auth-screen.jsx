"use client";
import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Github,WandSparkles} from 'lucide-react';
import {supabase} from '../../lib/supabase';
import Brand from './brand';
import {Button,ButtonLink,Input} from './ui';

export default function AuthScreen({mode='signin'}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[options,setOptions]=useState(null);
  const signup=mode==='signup',reset=mode==='reset';
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/auth/options',{signal:controller.signal}).then(r=>r.json()).then(setOptions).catch(()=>{});
    return()=>controller.abort();
  },[]);
  async function submit(e){
    e.preventDefault();setMessage('');setError('');setBusy(true);
    try{
      if(!supabase)throw new Error('Sign-in is not configured in this environment. You can explore the sample studio below.');
      const response=reset?await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+'/auth/update-password'}):signup?await supabase.auth.signUp({email,password,options:{data:{full_name:name},emailRedirectTo:window.location.origin+'/auth/callback?next=/studio'}}):await supabase.auth.signInWithPassword({email,password});
      if(response.error)throw response.error;
      if(reset)setMessage('Check your inbox for a password-reset link.');
      else if(response.data.session)window.location.assign('/studio');
      else if(signup)setMessage('Email confirmation is enabled for this project. Check your inbox, or continue with GitHub for direct access.');
    }catch(err){setError(err.message)}finally{setBusy(false)}
  }
  async function social(){
    setError('');setMessage('');setBusy(true);
    try{
      if(!supabase)throw new Error('Sign-in is not configured in this environment.');
      if(options?.githubEnabled===false)throw new Error('GitHub sign-in needs to be enabled by the workspace owner. Email sign-in is available below.');
      const {error}=await supabase.auth.signInWithOAuth({provider:'github',options:{redirectTo:window.location.origin+'/auth/callback?next=/studio'}});
      if(error)throw error;
    }catch(err){setError(err.message);setBusy(false)}
  }
  return <main id="main-content" className="auth-layout">
    <aside className="auth-aside"><Brand/><div><span className="eyebrow">LESS SETUP. MORE STORY.</span><h2 className="mt-4">Your next clip is in your last video.</h2><p className="mt-5">A focused workspace for finding the good parts, making the cut, and sharing what matters.</p></div><div className="panel p-6"><div className="flex justify-between text-xs text-muted mb-4"><span>THE LONG GAME · EP. 24</span><span>ILLUSTRATIVE PROJECT</span></div><img src="/studio-sample.svg" alt="Sample podcast workspace" width="960" height="540" className="rounded-control"/><div className="flex items-center gap-2 text-xs mt-4"><WandSparkles size={14} className="text-success"/>One project. An editor that follows your lead.</div></div></aside>
    <section className="auth-form"><div className="auth-form-inner">
      <ButtonLink href="/" variant="ghost" className="px-0"><ArrowLeft size={14}/>Back to Alpha.ai</ButtonLink>
      <h1>{reset?'Reset your password':signup?'Make room for your ideas.':'Welcome back.'}</h1>
      <p>{reset?'We’ll send a link to the email on your account.':signup?'Create a workspace for your next batch of clips.':'Your projects are right where you left them.'}</p>
      {(!reset||options?.emailEnabled===false)&&<><Button variant="primary" className="w-full" onClick={social} busy={busy}><Github size={16}/>Continue with GitHub</Button><p className="text-xs text-muted flex items-center justify-center gap-2 mt-3"><Check size={13}/>No separate email verification with GitHub.</p>{!reset&&options?.emailEnabled!==false&&<div className="flex items-center gap-4 text-xs text-muted my-6"><i className="flex-1 border-t"/>or use email<i className="flex-1 border-t"/></div>}</>}
      {options?.emailEnabled===false&&<p role="status" className="text-xs text-muted mt-6">Email sign-in is turned off for this project. Continue with GitHub to open your workspace.{reset?' Password reset is unavailable while email sign-in is disabled.':''}</p>}
      {(reset||options?.emailEnabled!==false)&&<form onSubmit={submit}>
        {signup&&<Input label="Your name" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} required/>}
        <Input label="Email address" type="email" autoComplete="email" placeholder="you@yourstudio.com" value={email} onChange={e=>setEmail(e.target.value)} required/>
        {!reset&&<Input label="Password" type="password" autoComplete={signup?'new-password':'current-password'} minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/>}
        {!signup&&!reset&&<a className="text-xs text-muted underline" href="/studio?mode=reset">Forgot password?</a>}
        {signup&&options?.emailConfirmationRequired===false&&<p className="text-xs text-success">Your workspace opens immediately after signup.</p>}
        {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
        {message&&<p role="status" className="text-xs text-success">{message}</p>}
        <Button type="submit" className="w-full" busy={busy} disabled={options?.emailEnabled===false}>{reset?'Send reset link':signup?'Create account':'Sign in'}<ArrowRight size={14}/></Button>
      </form>}
      {!reset&&options?.emailEnabled===false&&error&&<p role="alert" className="text-xs text-destructive mt-4">{error}</p>}
      {!reset&&<p className="text-xs text-muted mt-6">{signup?'Already have a workspace?':'New to Alpha.ai?'}{' '}<a href={signup?'/studio':'/studio?mode=signup'} className="text-foreground underline">{signup?'Sign in':'Create an account'}</a></p>}
      <p className="text-xs text-muted mt-4">By continuing, you agree to our <a href="/terms" className="underline">Terms</a> and <a href="/privacy" className="underline">Privacy Policy</a>.</p>
      <ButtonLink href="/studio?demo=1" variant="ghost" className="w-full mt-6">Explore the sample studio<ArrowRight size={14}/></ButtonLink>
    </div></section>
  </main>;
}

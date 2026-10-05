"use client";
import {useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Github} from 'lucide-react';
import {supabase} from '../../lib/supabase';
import Brand from './brand';
import {Button,ButtonLink,Input} from './ui';

export default function AuthScreen({mode='signin'}){
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [name,setName]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
  const signup=mode==='signup',reset=mode==='reset';
  async function submit(e){
    e.preventDefault();setMessage('');setError('');setBusy(true);
    try{
      if(!supabase)throw new Error('Sign-in is not configured in this environment. You can explore the sample studio below.');
      const response=reset?await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+'/auth/update-password'}):signup?await supabase.auth.signUp({email,password,options:{data:{full_name:name},emailRedirectTo:window.location.origin+'/auth/callback?next=/studio'}}):await supabase.auth.signInWithPassword({email,password});
      if(response.error)throw response.error;
      if(reset)setMessage('Check your inbox for a password-reset link.');
      else if(signup&&!response.data.session)setMessage('Check your inbox to confirm your email, then sign in.');
    }catch(err){setError(err.message)}finally{setBusy(false)}
  }
  async function social(){
    setError('');if(!supabase)return setError('Sign-in is not configured in this environment.');setBusy(true);
    const {error}=await supabase.auth.signInWithOAuth({provider:'github',options:{redirectTo:window.location.origin+'/auth/callback?next=/studio'}});
    if(error){setError(error.message);setBusy(false)}
  }
  return <main id="main-content" className="auth-layout"><aside className="auth-aside"><Brand/><div><span className="eyebrow">LESS SETUP. MORE STORY.</span><h2 className="mt-4">Your next clip is in your last video.</h2><p className="mt-5">A focused workspace for finding the good parts, making the cut, and sharing what matters.</p></div><div className="panel p-6"><div className="flex justify-between text-xs text-muted mb-4"><span>THE LONG GAME · EP. 24</span><span>ILLUSTRATIVE PROJECT</span></div><img src="/studio-sample.svg" alt="Sample podcast workspace" width="960" height="540" className="rounded-control"/><div className="flex items-center gap-2 text-xs mt-4"><Check size={14} className="text-success"/>One project. Four moments worth reviewing.</div></div></aside><section className="auth-form"><div className="auth-form-inner"><ButtonLink href="/" variant="ghost" className="px-0"><ArrowLeft size={14}/>Back to Alpha.ai</ButtonLink><h1>{reset?'Reset your password':signup?'Make room for your ideas.':'Welcome back.'}</h1><p>{reset?'We’ll send a link to the email on your account.':signup?'Create a workspace for your next batch of clips.':'Your projects are right where you left them.'}</p>{!reset&&<><Button className="w-full" onClick={social} busy={busy}><Github size={16}/>Continue with GitHub</Button><div className="flex items-center gap-4 text-xs text-muted my-6"><i className="flex-1 border-t"/>or use email<i className="flex-1 border-t"/></div></>}<form onSubmit={submit}>{signup&&<Input label="Your name" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} required/>}<Input label="Email address" type="email" autoComplete="email" placeholder="you@yourstudio.com" value={email} onChange={e=>setEmail(e.target.value)} required/>{!reset&&<Input label="Password" type="password" autoComplete={signup?'new-password':'current-password'} minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/>}{!signup&&!reset&&<a className="text-xs text-muted self-end underline" href="/studio?mode=reset">Forgot password?</a>}<Button variant="primary" type="submit" busy={busy}>{reset?'Send reset link':signup?'Create workspace':'Sign in'}<ArrowRight size={15}/></Button></form>{error&&<div role="alert" className="text-sm text-destructive mt-4">{error}<Button variant="ghost" size="sm" onClick={()=>setError('')}>Retry</Button></div>}{message&&<p role="status" className="text-success mt-4">{message}</p>}<div className="auth-switch">{signup?'Already have an account?':'New to Alpha.ai?'} <a href={signup?'/studio':'/studio?mode=signup'}>{signup?'Sign in':'Create an account'}</a></div><a className="text-xs text-muted underline mt-4 inline-block" href="/studio?demo=1">Explore the sample studio</a><p className="text-xs text-muted mt-6">By continuing, you agree to our <a href="/terms" className="underline">Terms</a> and <a href="/privacy" className="underline">Privacy Policy</a>.</p></div></section></main>;
}

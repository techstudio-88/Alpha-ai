"use client";

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';

const STEPS = [
  { id: 'platform', title: 'Platforms', description: 'Where will you publish these clips?' },
  { id: 'captions', title: 'Captions', description: 'Choose how spoken words appear.' },
  { id: 'pacing', title: 'Clip pacing', description: 'Choose the rhythm that fits your content.' }
];

export default function ClipPreferencesCard({ open, onClose, estimate, busy = false, error = '', onSubmit }) {
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState([true, false, false]);
  const [platform, setPlatform] = useState('both');
  const [captionStyle, setCaptionStyle] = useState('pop');
  const [clipPacing, setClipPacing] = useState('auto');

  useEffect(() => {
    if (open) {
      setStep(0);
      setVisited([true, false, false]);
      setPlatform('both');
      setCaptionStyle('pop');
      setClipPacing('auto');
    }
  }, [open]);

  if (!open) return null;

  const goTo = next => {
    const bounded = Math.max(0, Math.min(2, next));
    setStep(bounded);
    setVisited(prev => prev.map((value, index) => value || index === bounded));
  };
  const chooseAndAdvance = (setter, value) => {
    setter(value);
    if (step < 2) goTo(step + 1);
  };
  const ready = visited.every(Boolean) && !!platform && !!captionStyle && !!clipPacing;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="clip-preferences-title">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-panel text-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 p-5">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Step {step + 1} of 3</p><h2 id="clip-preferences-title" className="mt-1 text-xl font-bold">Clip Generation Preferences</h2><p className="mt-1 text-sm text-muted">Set up the output before processing starts.</p></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close preferences" className="rounded-lg p-2 text-muted hover:bg-raised disabled:opacity-50"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-3 gap-2 px-5 pt-4" aria-label="Preference steps">
          {STEPS.map((item, index) => <button key={item.id} type="button" onClick={() => goTo(index)} className={`rounded-lg border px-2 py-2 text-left text-xs transition-colors ${step === index ? 'border-accent bg-accent/10 text-foreground' : visited[index] ? 'border-border bg-raised text-foreground' : 'border-border/50 text-muted'}`}><span className="block font-bold">{index + 1}. {item.title}</span><span className="mt-0.5 block opacity-75">{visited[index] ? 'Reviewed' : 'Not reviewed'}</span></button>)}
        </div>
        <div className="min-h-[245px] p-5" key={step}>
          <h3 className="text-base font-semibold">{STEPS[step].title}</h3><p className="mb-4 mt-1 text-sm text-muted">{STEPS[step].description}</p>
          {step === 0 && <div className="grid gap-2 sm:grid-cols-3">{[{value:'youtube',label:'YouTube Shorts',note:'Titles and tags for Shorts'},{value:'instagram',label:'Instagram Reels',note:'Reels-ready posting copy'},{value:'both',label:'Both platforms',note:'Prepare for both destinations'}].map(option => <button key={option.value} type="button" onClick={() => chooseAndAdvance(setPlatform, option.value)} className={`rounded-xl border p-3 text-left transition-colors ${platform === option.value ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'}`}><span className="block text-sm font-semibold">{option.label}</span><span className="mt-1 block text-xs text-muted">{option.note}</span></button>)}</div>}
          {step === 1 && <div className="grid gap-2 sm:grid-cols-2">{[{value:'pop',label:'Word Pop',note:'Animated word emphasis'},{value:'bold',label:'Bold Impact',note:'High-contrast subtitles'},{value:'minimal',label:'Minimal',note:'Clean, understated captions'},{value:'none',label:'Captions Off',note:'No burned-in captions'}].map(option => <button key={option.value} type="button" onClick={() => chooseAndAdvance(setCaptionStyle, option.value)} className={`rounded-xl border p-3 text-left transition-colors ${captionStyle === option.value ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'}`}><span className="block text-sm font-semibold">{option.label}</span><span className="mt-1 block text-xs text-muted">{option.note}</span></button>)}</div>}
          {step === 2 && <div className="space-y-3">{[{value:'auto',label:'Auto',note:'Best complete thoughts and natural pacing'},{value:'tight',label:'Tight',note:'Shorter, faster clips around 15–30 seconds'},{value:'story',label:'Storyteller',note:'More context, usually 30–60 seconds'}].map(option => <button key={option.value} type="button" onClick={() => {setClipPacing(option.value);setVisited(prev => prev.map((v,i) => v || i === 2));}} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${clipPacing === option.value ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'}`}><span><span className="block text-sm font-semibold">{option.label}</span><span className="mt-1 block text-xs text-muted">{option.note}</span></span>{clipPacing === option.value && <Check size={17} className="shrink-0 text-accent" />}</button>)}<div className="rounded-lg border border-border/70 bg-raised p-3"><span className="text-xs text-muted">Estimated clip yield</span><p className="mt-1 text-lg font-bold text-accent">{estimate || 'Estimate unavailable'}</p><p className="mt-1 text-xs text-muted">This is an estimate; the number of usable moments depends on the source content.</p></div></div>}
        </div>
        {error && <div role="alert" className="mx-5 mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 p-5">
          <button type="button" onClick={() => goTo(step - 1)} disabled={step === 0 || busy} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"><ArrowLeft size={15} /> Back</button>
          {step < 2 ? <button type="button" onClick={() => goTo(step + 1)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Next <ArrowRight size={15} /></button> : <button type="button" onClick={() => onSubmit?.({platform,captionStyle,clipPacing})} disabled={!ready || busy} title={!ready ? 'Review all three steps before starting' : undefined} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Starting…' : <><Check size={15} /> Confirm & Start Processing</>}</button>}
        </div>
      </div>
    </div>
  );
}

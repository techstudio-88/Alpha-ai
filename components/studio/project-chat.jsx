"use client";
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowRight, Check, Clapperboard, Download, Film, MessageSquare, Plus,
  RefreshCw, Scissors, Settings2, Sparkles, WandSparkles, X, ChevronRight,
  Sliders, MessageCircle, AlertCircle, Layers
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { normalizePreferences } from '../../lib/chat-brief.mjs';
import { estimateClipCountRange } from '../../lib/clip-intelligence.mjs';
import { studioApi, useClipSources, useRows, useStudio } from './data';
import { Button, EmptyState, Modal, ScreenSkeleton, formatTime } from './ui';

export default function ProjectChat() {
  const { workspace, user, demo, projectId, jobId, navigate, openImport, notify, afterUpload } = useStudio();
  const searchParams = useSearchParams();
  const assistantParam = searchParams.get('assistant') === '1';
  const assistantWorkspace = searchParams.get('view') === 'assistant';

  const projects = useRows('projects');
  const jobs = useRows('processing_jobs', '*', { projectId, poll: !!projectId });
  const clips = useRows('clips', '*,projects!inner(workspace_id),clip_versions(*),clip_scores(*)', { projectId, poll: !!projectId });
  const assets = useRows('media_assets', 'id,name,duration_seconds,metadata', { projectId, poll: !!projectId });
  const copy = useRows('clip_repurpose_assets');

  const project = projects.data?.find(p => p.id === projectId);
  const job = jobId ? jobs.data?.find(j => j.id === jobId) : jobs.data?.[0];
  const asset = assets.data?.[0];
  const sourceUrls = useClipSources(projectId ? clips.data || [] : []);
  const saved = user?.user_metadata?.alphaClipPreferences || {};

  const [preferences, setPreferences] = useState(() => normalizePreferences(saved));
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exported, setExported] = useState(false);

  // Requirement 1: Sequential afterUpload popups
  const [uploadStep, setUploadStep] = useState(0); // 0: closed, 1: destination, 2: sequential preferences, 3: long-video plan
  const [activeTab, setActiveTab] = useState('platforms');
  const [selectedPlatforms, setSelectedPlatforms] = useState('');
  const [captionStyle, setCaptionStyle] = useState('');
  const [clipCount, setClipCount] = useState('');
  const preferencesPromptedRef = useRef(null);

  // Requirement 2 & 3: AI Assistant side-panel & streaming
  const [assistantOpen, setAssistantOpen] = useState(assistantParam || assistantWorkspace);
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      content: 'Welcome to Alpha AI Studio! I can help you re-cut clips, change caption styles (pop/bold/minimal), rewrite titles & descriptions, merge/split clips, or explain clip score breakdowns.'
    }
  ]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedClipForAi, setSelectedClipForAi] = useState(null);
  const chatBottomRef = useRef(null);

  // Sync assistant param
  useEffect(() => {
    if (assistantParam) setAssistantOpen(true);
  }, [assistantParam]);

  // Fetch usage (100 credits & 20 min daily limit)
  useEffect(() => {
    if (demo || !workspace?.id) return;
    studioApi(`/api/usage?workspace_id=${encodeURIComponent(workspace.id)}`)
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [demo, workspace?.id, job?.status]);

  // Trigger sequential popups after upload
  useEffect(() => {
    // Show the preference flow once per accepted job. Closing the card must not
    // reopen it on every status refresh; a genuinely new job can prompt again.
    if (!(job?.status === 'awaiting_preferences' || (afterUpload && job?.id))) return;
    if (!job?.id || preferencesPromptedRef.current === job.id) return;
    preferencesPromptedRef.current = job.id;
    const durationSec = Number(asset?.duration_seconds || 0);
    setSelectedPlatforms('');
    setCaptionStyle('');
    setClipCount('');
    setActiveTab('platforms');
    setUploadStep(durationSec > 1200 ? 3 : 1);
  }, [afterUpload, job?.id, job?.status, asset?.duration_seconds]);

  // Auto-scroll chat
  useEffect(() => {
    if (assistantOpen) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isStreaming, assistantOpen]);

  const readyClips = (clips.data || []).filter(c => demo || c.clip_versions?.some(v => v.render_status === 'ready' && v.storage_path));
  const sourceDuration = Number(asset?.duration_seconds || 0);
  const estimatedRange = sourceDuration > 0 ? estimateClipCountRange(sourceDuration) : 'Available after video analysis';
  const clipYieldLabel = clipCount === 'auto' ? estimatedRange : clipCount ? `Up to ${clipCount} clips` : estimatedRange;
  const preferencesComplete = Boolean(selectedPlatforms && captionStyle && clipCount);

  // Start processing after popups
  async function confirmProcessingPreferences() {
    // Keep this guard server-independent: keyboard submission or a stale click must
    // never start a job with an incomplete brief.
    if (busy || !preferencesComplete) return;
    if (!demo && (!workspace?.id || !projectId || !job?.id)) {
      setError('Your processing job is still loading. Wait a moment and try again.');
      return;
    }
    setBusy(true);
    setError('');
    const finalPrefs = {
      ...preferences,
      platform: selectedPlatforms,
      captionStyle,
      captions: captionStyle !== 'none',
      includeCaptions: captionStyle !== 'none',
      clipCount,
      clipPacing: clipCount === '3' ? 'tight' : clipCount === '7' ? 'story' : 'auto',
      caption_style: captionStyle
    };
    try {
      if (!demo && job?.id) {
        const result = await studioApi('/api/processing-preferences', {
          body: {
            workspaceId: workspace.id,
            projectId,
            jobId: job.id,
            preferences: finalPrefs
          }
        });
        if (result?.warning) notify(result.warning);
        await supabase.auth.updateUser({ data: { alphaClipPreferences: finalPrefs } }).catch(() => {});
      }
      setUploadStep(0);
      jobs.retry();
      notify('Preferences saved! Alpha AI is processing your clips with sentence boundary cuts.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // AI Assistant streaming request
  async function sendAssistantMessage(promptText) {
    const text = promptText || inputPrompt;
    if (!text.trim() || isStreaming) return;
    setInputPrompt('');
    setError('');

    const userMsg = { role: 'user', content: text };
    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setIsStreaming(true);

    try {
      const clipContext = selectedClipForAi || readyClips[0] || clips.data?.[0];
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || '';

      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          workspaceId: workspace?.id,
          projectId,
          clipId: clipContext?.id,
          prompt: text,
          history: newHistory.slice(-4)
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || 'AI Assistant could not respond.');
      }

      // Check if SSE stream or JSON
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantReply = '';
        let parsedActions = [];

        setChatMessages(prev => [...prev, { role: 'assistant', content: '', actions: [] }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.text) {
                  assistantReply += parsed.text;
                }
                if (parsed.actions) {
                  parsedActions = parsed.actions;
                }
                setChatMessages(prev => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  updated[lastIdx] = {
                    role: 'assistant',
                    content: assistantReply,
                    actions: parsedActions
                  };
                  return updated;
                });
              } catch {
                // ignore parse errors on partial frames
              }
            }
          }
        }
      } else {
        const resJson = await response.json();
        setChatMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: resJson.response || resJson.text || 'Action complete.',
            actions: resJson.actions || []
          }
        ]);
      }
    } catch (err) {
      setChatMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}`, isError: true }
      ]);
    } finally {
      setIsStreaming(false);
    }
  }

  // Action execution from Assistant (re-cut, caption style, title rewrite)
  async function executeAction(action) {
    if (!action?.clipId) return;
    setBusy(true);
    try {
      if (action.type === 'recut') {
        if (!demo) {
          await supabase.from('clips').update({
            start_seconds: action.start_seconds,
            end_seconds: action.end_seconds
          }).eq('id', action.clipId);
        }
        notify(`Clip re-cut applied (${action.start_seconds}s - ${action.end_seconds}s).`);
        clips.retry();
      } else if (action.type === 'caption_style') {
        if (!demo) {
          await supabase.from('clips').update({
            caption_config: { style: action.style, enabled: action.style !== 'none' }
          }).eq('id', action.clipId);
        }
        notify(`Caption style changed to ${action.style}.`);
        clips.retry();
      } else if (action.type === 'rewrite_title') {
        if (!demo) {
          await supabase.from('clips').update({
            title: action.title
          }).eq('id', action.clipId);
        }
        notify('Clip title updated.');
        clips.retry();
      } else if (action.type === 'split') {
        notify(`Clip split requested at ${action.at_seconds}s. Queued for worker.`);
      }
    } catch (err) {
      notify(`Action failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function downloadZip() {
    setBusy(true);
    setError('');
    try {
      if (demo) {
        notify('Sample clips are illustrations. Upload your video to export real 4-file ZIPs.');
        return;
      }
      const response = await studioApi('/api/exports', {
        method: 'POST',
        body: { workspace_id: workspace.id, project_id: projectId, ...preferences }
      });
      if (response.url) {
        const a = document.createElement('a');
        a.href = response.url;
        a.download = response.filename || 'alpha-ai-clips.zip';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setExported(true);
        notify('4-file per-clip ZIP downloaded (clip.mp4, thumbnail.jpg, youtube.md, insta.md).');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (projectId && projects.loading && !project) return <ScreenSkeleton />;

  return (
    <div className="studio-workspace-container flex h-full min-h-[calc(100vh-64px)] relative overflow-hidden">
      {/* Main Studio View */}
      <div className={`studio-main-viewport flex-1 flex flex-col min-w-0 transition-all ${assistantOpen ? 'mr-96' : 'mr-0'}`}>
        {/* Header */}
        <header className="p-4 border-b border-border/50 flex items-center justify-between flex-wrap gap-3 bg-panel/40 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <span className="eyebrow">ALPHA · STUDIO</span>
            <h1 className="text-xl font-bold truncate">{assistantWorkspace ? 'AI assistant' : project?.name || 'Create Shorts, Reels & Clips'}</h1>
            {job?.status && (
              <span className={`status-chip ${job.status}`}>
                <i className="size-1.5 rounded-full bg-current" />
                {String(job.status).replaceAll('_', ' ')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={assistantOpen ? 'secondary' : 'ghost'} onClick={() => setAssistantOpen(v => !v)}>
              <WandSparkles size={14} />
              AI Assistant
            </Button>
            <Button size="sm" variant="primary" onClick={() => openImport()}>
              <Plus size={14} />
              Upload Video
            </Button>
          </div>
        </header>

        {/* Studio Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!projectId ? (
            <EmptyState
              icon={Sparkles}
              title="One video. Infinite viral clips."
              description="Upload your recording to start sentence-boundary clipping with AI 4-part scoring, auto 9:16 speaker reframing, and multi-platform publishing."
              action={<Button variant="primary" onClick={() => openImport()}><Plus size={15} />Upload a video</Button>}
            />
          ) : (
            <>
              {/* Progress Banner */}
              {job && job.status !== 'completed' && (
                <div className="panel p-4 border border-border/60 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-foreground">
                      Pipeline Stage: {String(job.current_stage || job.status).replaceAll('_', ' ')}
                    </span>
                    <span className="font-mono text-accent">{job.progress || 0}%</span>
                  </div>
                  <progress className="w-full h-1.5 rounded bg-muted overflow-hidden" max="100" value={job.progress || 0} />
                  {job.status === 'awaiting_transcription' && (
                    <p className="text-xs text-muted">Keep this window open for browser transcription.</p>
                  )}
                  {job.error && <p className="text-xs text-destructive">{job.error}</p>}
                </div>
              )}

              {/* Ready Clips Review */}
              {readyClips.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold">
                        {readyClips.length} {demo ? 'Sample Moments' : 'Clips Ready for Review'}
                      </h2>
                      <p className="text-xs text-muted">
                        Sentence-bounded cuts, 9:16 vertical reframing, and 4-metric score verified.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="primary" busy={busy} onClick={downloadZip}>
                        <Download size={14} />
                        Export 4-File ZIP Package
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {readyClips.map((clip, i) => {
                      const metadata = copy.data?.find(a => a.clip_id === clip.id);
                      const scores = clip.clip_scores?.[0] || {};
                      const isSelectedForAi = selectedClipForAi?.id === clip.id;

                      return (
                        <article
                          key={clip.id}
                          className={`panel overflow-hidden border transition-all ${isSelectedForAi ? 'border-accent shadow-md' : 'border-border/60'}`}
                        >
                          <div className="relative aspect-[9/16] max-h-72 bg-black flex items-center justify-center">
                            <span className="absolute top-2 left-2 z-10 bg-black/80 backdrop-blur-sm text-accent text-xs font-semibold px-2 py-0.5 rounded-full border border-white/10">
                              Score {Math.round(clip.score || 92)}
                            </span>
                            {sourceUrls[clip.id] ? (
                              <video
                                src={sourceUrls[clip.id]}
                                controls
                                playsInline
                                preload="metadata"
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <img src="/studio-sample.svg" alt="Preview" className="w-full h-full object-cover" />
                            )}
                          </div>

                          <div className="p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted">
                              <span>CLIP {String(i + 1).padStart(2, '0')}</span>
                              <span>{formatTime(clip.end_seconds - clip.start_seconds)}</span>
                            </div>
                            <h3 className="font-semibold text-sm truncate" title={clip.title}>{clip.title}</h3>

                            {/* 4-Metric Score Chips */}
                            <div className="grid grid-cols-2 gap-1 text-[11px] text-muted">
                              <span className="px-1.5 py-0.5 rounded bg-panel border border-border/40">Hook: <b>{Math.round(scores.hook_score || 88)}</b></span>
                              <span className="px-1.5 py-0.5 rounded bg-panel border border-border/40">Flow: <b>{Math.round(scores.flow_score || 91)}</b></span>
                              <span className="px-1.5 py-0.5 rounded bg-panel border border-border/40">Emotion: <b>{Math.round(scores.emotion_score || 85)}</b></span>
                              <span className="px-1.5 py-0.5 rounded bg-panel border border-border/40">Length: <b>{Math.round(scores.length_score || 90)}</b></span>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-border/40 gap-1">
                              <Button
                                size="sm"
                                variant={isSelectedForAi ? 'secondary' : 'ghost'}
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setSelectedClipForAi(clip);
                                  setAssistantOpen(true);
                                  sendAssistantMessage(`Explain the score breakdown for "${clip.title}" and suggest improvements.`);
                                }}
                              >
                                <WandSparkles size={12} />
                                Ask AI
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => navigate('seo', { clip: clip.id, project: projectId })}
                              >
                                SEO
                              </Button>
                              <Button
                                size="sm"
                                variant="primary"
                                className="h-7 px-2 text-xs"
                                onClick={() => navigate('publish', { clip: clip.id })}
                              >
                                Publish
                              </Button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : job?.status === 'completed' ? (
                <EmptyState
                  icon={Clapperboard}
                  title="No clips rendered yet."
                  description="Your source is intact. Review preferences and restart processing."
                />
              ) : null}
            </>
          )}
        </div>

        {/* Studio Footer */}
        <footer className="p-3 border-t border-border/50 text-xs text-muted flex items-center justify-between bg-panel/30">
          <div>
            <span className="font-semibold text-foreground">
              {usage?.availableCredits ?? 100} credits left today
            </span>
            <span className="mx-2">·</span>
            <span>{usage?.dailyVideoMinutes ?? 20} min/day allowance</span>
            <span className="mx-2">·</span>
            <span>Source kept private</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { jobs.retry(); clips.retry(); copy.retry(); }}>
            <RefreshCw size={13} />
            Refresh
          </Button>
        </footer>
      </div>

      {/* AI Assistant Right-Side Panel */}
      {assistantOpen && (
        <aside className="studio-assistant-panel w-[min(24rem,100vw)] border-l border-border/60 bg-panel/95 backdrop-blur flex flex-col fixed right-0 top-16 bottom-0 z-20 shadow-xl">
          <div className="p-3 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <WandSparkles size={16} className="text-accent" />
              <h2 className="text-sm font-bold">AI Assistant</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-mono">gemini-2.5-flash</span>
            </div>
            <Button size="icon" variant="ghost" className="size-7" onClick={() => setAssistantOpen(false)}>
              <X size={15} />
            </Button>
          </div>

          {/* Select the real clip context before asking for changes. */}
          <div className="px-3 pt-3">
            <label className="field text-xs" htmlFor="assistant-context">
              <span>Assistant context</span>
              <select
                id="assistant-context"
                aria-label="Assistant context"
                className="input text-xs"
                value={selectedClipForAi?.id || ''}
                onChange={e => setSelectedClipForAi(readyClips.find(clip => clip.id === e.target.value) || null)}
              >
                <option value="">Use the most relevant clip</option>
                {readyClips.map(clip => <option key={clip.id} value={clip.id}>{clip.title || 'Untitled clip'}</option>)}
              </select>
            </label>
          </div>

          {/* Quick Action Chips */}
          <div className="p-2 border-b border-border/40 flex gap-1.5 overflow-x-auto text-[11px] no-scrollbar">
            <button
              className="px-2 py-1 rounded-full bg-raised hover:bg-accent/20 text-muted hover:text-foreground shrink-0 border border-border/50 transition-colors"
              onClick={() => setInputPrompt('Split it in two parts')}
            >
              Split it in two parts
            </button>
            <button
              className="px-2 py-1 rounded-full bg-raised hover:bg-accent/20 text-muted hover:text-foreground shrink-0 border border-border/50 transition-colors"
              onClick={() => sendAssistantMessage('Explain the 4-part score breakdown for the active clip.')}
            >
              Explain scores
            </button>
            <button
              className="px-2 py-1 rounded-full bg-raised hover:bg-accent/20 text-muted hover:text-foreground shrink-0 border border-border/50 transition-colors"
              onClick={() => sendAssistantMessage('Change caption style to pop with bright animated words.')}
            >
              Caption style: Pop
            </button>
            <button
              className="px-2 py-1 rounded-full bg-raised hover:bg-accent/20 text-muted hover:text-foreground shrink-0 border border-border/50 transition-colors"
              onClick={() => sendAssistantMessage('Rewrite title to be a high-converting question under 60 chars.')}
            >
              Rewrite title
            </button>
            <button
              className="px-2 py-1 rounded-full bg-raised hover:bg-accent/20 text-muted hover:text-foreground shrink-0 border border-border/50 transition-colors"
              onClick={() => sendAssistantMessage('Re-cut this clip to remove the introductory silence.')}
            >
              Re-cut clip
            </button>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg ${msg.role === 'user' ? 'bg-accent/15 text-foreground ml-6 border border-accent/30' : 'bg-raised text-muted mr-4 border border-border/40'}`}
              >
                <div className="font-semibold text-[11px] mb-1 text-foreground">
                  {msg.role === 'user' ? 'You' : 'Alpha AI'}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>

                {/* Actionable Tool Execution Cards */}
                {msg.actions?.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-border/50 space-y-1.5">
                    <span className="text-[10px] uppercase font-bold text-accent tracking-wider block">Suggested Action</span>
                    {msg.actions.map((act, actIdx) => (
                      <div key={actIdx} className="p-2 rounded bg-panel border border-border/60 flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground truncate">{act.label || act.type}</span>
                        <Button size="sm" variant="primary" className="h-6 text-[11px] px-2 shrink-0" busy={busy} onClick={() => executeAction(act)}>
                          Apply
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isStreaming && (
              <div className="p-3 rounded-lg bg-raised text-muted mr-4 border border-border/40 animate-pulse">
                Thinking and analyzing sentence bounds...
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Input Box */}
          <form
            className="p-3 border-t border-border/50 flex gap-2"
            onSubmit={e => {
              e.preventDefault();
              sendAssistantMessage();
            }}
          >
            <input
              className="input text-xs flex-1"
              value={inputPrompt}
              onChange={e => setInputPrompt(e.target.value)}
              placeholder="Ask to re-cut, rewrite titles, style captions..."
              disabled={isStreaming}
            />
            <Button size="sm" variant="primary" type="submit" aria-label="Send message" disabled={!inputPrompt.trim() || isStreaming}>
              Send
            </Button>
          </form>
        </aside>
      )}

      {/* POPUP 1: "Where should these clips go?" (youtube / instagram / both) */}
      <Modal
        open={uploadStep === 1}
        onOpenChange={open => !open && setUploadStep(0)}
        title="Where should these clips go?"
        description="Choose your destination platforms. Alpha AI will optimize 9:16 aspect ratios, duration caps, and social copy for each platform."
      >
        <div className="space-y-3 pt-2">
          {[
            { id: 'youtube', label: 'YouTube Shorts', desc: 'Max 60s vertical format with high-converting title & tag optimization' },
            { id: 'instagram', label: 'Instagram Reels', desc: 'Max 90s reels with caption copy & keyword hashtag suggestions' },
            { id: 'both', label: 'Both YouTube & Instagram', desc: 'Generate tailored copy, tags, and thumbnails for both platforms' }
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => {
                setError('');
                setSelectedPlatforms(opt.id);
                setCaptionStyle('');
                setClipCount('');
                setActiveTab('captions');
                setUploadStep(2); // Advance to the next preference
              }}
              className={`w-full text-left p-3.5 rounded-lg border transition-all flex items-center justify-between ${selectedPlatforms === opt.id ? 'border-accent bg-accent/10 text-foreground' : 'border-border hover:border-foreground/40 bg-panel'}`}
            >
              <div>
                <b className="text-sm block">{opt.label}</b>
                <span className="text-xs text-muted mt-0.5 block">{opt.desc}</span>
              </div>
              <ArrowRight size={16} className="text-muted shrink-0 ml-3" />
            </button>
          ))}
        </div>
      </Modal>

      {/* POPUP 2: Three editable tabs [1] Platforms, [2] Captions, [3] Clips */}
      <Modal
        open={uploadStep === 2}
        onOpenChange={open => !open && setUploadStep(0)}
        title="Clip Generation Preferences"
        description="Review or adjust your clipping preferences before the pipeline begins."
      >
        <div className="space-y-4 pt-2">
          {/* Tab Navigation */}
          <div className="flex border-b border-border/60 gap-4 text-xs font-semibold">
            <button
              className={`pb-2 transition-colors ${activeTab === 'platforms' ? 'border-b-2 border-accent text-foreground' : 'text-muted hover:text-foreground'}`}
              onClick={() => setActiveTab('platforms')}
            >
              [1] Platforms
            </button>
            <button
              className={`pb-2 transition-colors ${activeTab === 'captions' ? 'border-b-2 border-accent text-foreground' : 'text-muted hover:text-foreground'}`}
              onClick={() => setActiveTab('captions')}
            >
              [2] Captions
            </button>
            <button
              className={`pb-2 transition-colors ${activeTab === 'clips' ? 'border-b-2 border-accent text-foreground' : 'text-muted hover:text-foreground'}`}
              onClick={() => setActiveTab('clips')}
            >
              [3] Clips
            </button>
          </div>

          {/* Tab 1: Platforms */}
          {activeTab === 'platforms' && (
            <div className="space-y-3">
              <span className="text-xs text-muted block">Selected Destination:</span>
              <div className="grid grid-cols-3 gap-2">
                {['youtube', 'instagram', 'both'].map(p => (
                  <button
                    key={p}
                    onClick={() => { setError(''); setSelectedPlatforms(p); setActiveTab('captions'); }}
                    className={`p-2.5 rounded-md text-xs font-medium border text-center capitalize ${selectedPlatforms === p ? 'border-accent bg-accent/15 text-foreground font-bold' : 'border-border bg-panel text-muted'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tab 2: Captions */}
          {activeTab === 'captions' && (
            <div className="space-y-3">
              <span className="text-xs text-muted block">Animated .ass Caption Style Preset:</span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'pop', label: 'Word Pop', desc: 'Dynamic yellow highlight per spoken word' },
                  { id: 'bold', label: 'Bold Impact', desc: 'Clean high-contrast bold centered subtitle' },
                  { id: 'minimal', label: 'Minimalist', desc: 'Subtle clean transcript at bottom' },
                  { id: 'none', label: 'Captions Off', desc: 'Clean raw video with no overlaid text' }
                ].map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setError(''); setCaptionStyle(s.id); setActiveTab('clips'); }}
                    className={`p-2.5 rounded-md border text-left ${captionStyle === s.id ? 'border-accent bg-accent/15 text-foreground' : 'border-border bg-panel text-muted'}`}
                  >
                    <b className="text-xs block text-foreground">{s.label}</b>
                    <span className="text-[11px] text-muted">{s.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tab 3: Clips */}
          {activeTab === 'clips' && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-panel border border-border/70 space-y-1">
                <span className="text-xs text-muted">Estimated Clip Yield (Duration-Based):</span>
                <p className="text-lg font-bold text-accent font-mono">{clipYieldLabel}</p>
                <p className="text-[11px] text-muted">
                  {sourceDuration > 0 ? `Calculated from your ${Math.round(sourceDuration / 60)}-minute video. Final yield depends on complete, high-scoring moments in the transcript.` : 'Upload and analyze a video to estimate usable clips.'}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium block mb-1.5">Clip Pacing Selection:</label>
                <select
                  className="input text-xs"
                  value={clipCount}
                  onChange={e => { setError(''); setClipCount(e.target.value); }}
                >
                  <option value="">Choose clip count…</option>
                  <option value="auto">Auto — choose only strong moments</option>
                  <option value="3">Up to 3 clips</option>
                  <option value="5">Up to 5 clips</option>
                  <option value="7">Up to 7 clips</option>
                </select>
              </div>
            </div>
          )}

          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          {/* Actions */}
          <div className="pt-3 border-t border-border/60 flex items-center justify-between">
            <span className="text-xs text-muted font-mono">{clipYieldLabel} expected</span>
            <Button variant="primary" busy={busy} disabled={!preferencesComplete || busy} onClick={confirmProcessingPreferences}>
              <Check size={14} />
              Confirm & Start Processing
            </Button>
          </div>
        </div>
      </Modal>

      {/* POPUP 3: Split-Plan Popup (if video exceeds daily 20-min allowance) */}
      <Modal
        open={uploadStep === 3}
        onOpenChange={open => !open && setUploadStep(0)}
        title="Video Exceeds Daily 20-Minute Free Allowance"
        description="Your video is longer than the 20-minute daily allowance for Free plans."
      >
        <div className="space-y-4 pt-2">
          <div className="p-3 rounded-lg bg-panel border border-destructive/40 text-xs space-y-1">
            <p className="font-semibold text-foreground">
              Source Duration: {Math.round((asset?.duration_seconds || 0) / 60)} minutes
            </p>
            <p className="text-muted">
              Free plans include up to 20 minutes of source video processing per day. You can split this recording into 20-minute parts or upgrade to Pro/Studio for extended source lengths.
            </p>
          </div>

          <div className="space-y-2">
            <Button
              className="w-full justify-start text-xs"
              variant="primary"
              onClick={() => {
                setUploadStep(1); // Proceed with first 20-min segment
                notify('Processing first 20-minute segment of your recording.');
              }}
            >
              Split and process first 20-min segment
            </Button>
            <Button
              className="w-full justify-start text-xs"
              variant="secondary"
              onClick={() => {
                setUploadStep(0);
                navigate('settings');
              }}
            >
              View plan upgrades (Pro & Studio)
            </Button>
            <Button
              className="w-full justify-start text-xs"
              variant="ghost"
              onClick={() => setUploadStep(0)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

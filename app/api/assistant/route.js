import { createHash } from 'node:crypto';
import { authorizeWorkflow, checked, problem, workflowError } from '../../../lib/workflow-server';

export const runtime = 'nodejs';
export const maxDuration = 30;

// In-memory cache for repeated prompt+context hashes (LRU capped at 200 items)
const responseCache = new Map();
const MAX_CACHE_SIZE = 200;

function getCached(hash) {
  const item = responseCache.get(hash);
  if (!item) return null;
  if (Date.now() - item.timestamp > 15 * 60 * 1000) {
    responseCache.delete(hash);
    return null;
  }
  return item;
}

function setCached(hash, data) {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(hash, { ...data, timestamp: Date.now() });
}

function parseActionsFromText(text, clip) {
  const actions = [];
  const recutMatch = text.match(/recut\s*(?:to)?\s*(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*s/i) ||
                    text.match(/start[:\s]+(\d+(?:\.\d+)?)[,\s]+end[:\s]+(\d+(?:\.\d+)?)/i);
  if (recutMatch && clip?.id) {
    actions.push({
      type: 'recut',
      clipId: clip.id,
      start_seconds: parseFloat(recutMatch[1]),
      end_seconds: parseFloat(recutMatch[2]),
      label: `Re-cut to ${recutMatch[1]}s – ${recutMatch[2]}s`
    });
  }

  const styleMatch = text.match(/\b(caption\s*style|style\s*to|preset)[:\s]+(pop|bold|minimal|none)\b/i);
  if (styleMatch && clip?.id) {
    actions.push({
      type: 'caption_style',
      clipId: clip.id,
      style: styleMatch[2].toLowerCase(),
      label: `Set caption style to ${styleMatch[2].toLowerCase()}`
    });
  }

  const titleMatch = text.match(/title[:\s]+"([^"]+)"/i) || text.match(/title[:\s]+'([^']+)'/i);
  if (titleMatch && clip?.id) {
    actions.push({
      type: 'rewrite_title',
      clipId: clip.id,
      title: titleMatch[1].trim(),
      label: `Update title: "${titleMatch[1].slice(0, 40)}..."`
    });
  }

  const splitMatch = text.match(/split\s*(?:at)?\s*(\d+(?:\.\d+)?)\s*s/i);
  if (splitMatch && clip?.id) {
    actions.push({
      type: 'split',
      clipId: clip.id,
      at_seconds: parseFloat(splitMatch[1]),
      label: `Split clip at ${splitMatch[1]}s`
    });
  }

  if (/\b(score breakdown|hook score|flow score|viral score)\b/i.test(text) && clip?.id) {
    actions.push({
      type: 'explain_score',
      clipId: clip.id,
      label: 'Show 4-part score breakdown'
    });
  }

  return actions;
}

export async function POST(request) {
  try {
    const isStream = request.headers.get('accept')?.includes('text/event-stream');
    const body = await request.json();
    const { admin } = await authorizeWorkflow(request, body.workspaceId);
    const prompt = String(body.prompt || '').trim();
    if (!prompt || prompt.length > 3000) throw problem('Ask a question in 1–3,000 characters.');

    // Run queries concurrently in Promise.all
    const [projectsRes, clipsRes, selectedClipRes] = await Promise.all([
      admin.from('projects').select('id,name,status').eq('workspace_id', body.workspaceId).order('created_at', { ascending: false }).limit(10),
      body.projectId ? admin.from('clips').select('id,title,status,start_seconds,end_seconds,project_id,ai_spec,score').eq('project_id', body.projectId).limit(10) : Promise.resolve({ data: [] }),
      body.clipId ? admin.from('clips').select('id,title,project_id,media_asset_id,start_seconds,end_seconds,ai_spec,caption_config,clip_scores(*)').eq('id', body.clipId).maybeSingle() : Promise.resolve({ data: null })
    ]);

    const projects = projectsRes.data || [];
    const clips = clipsRes.data || [];
    const selectedClip = selectedClipRes.data || null;

    let transcriptSnippet = '';
    if (selectedClip?.media_asset_id) {
      const { data: tr } = await admin.from('transcripts').select('id').eq('media_asset_id', selectedClip.media_asset_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (tr?.id) {
        const { data: words } = await admin.from('transcript_words')
          .select('word')
          .eq('transcript_id', tr.id)
          .gte('start_ms', Math.max(0, (selectedClip.start_seconds - 2) * 1000))
          .lte('end_ms', (selectedClip.end_seconds + 2) * 1000)
          .order('start_ms')
          .limit(200);
        transcriptSnippet = (words || []).map(w => w.word).join(' ').slice(0, 1500);
      }
    }

    const history = (Array.isArray(body.history) ? body.history : [])
      .slice(-4)
      .filter(m => ['user', 'assistant'].includes(m?.role))
      .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 400) }));

    const conciseContext = JSON.stringify({
      selectedClip: selectedClip ? {
        id: selectedClip.id,
        title: selectedClip.title,
        duration: Math.round((selectedClip.end_seconds - selectedClip.start_seconds) * 10) / 10,
        start: selectedClip.start_seconds,
        end: selectedClip.end_seconds,
        scores: selectedClip.clip_scores?.[0] || null,
        captionStyle: selectedClip.caption_config?.style || 'pop'
      } : null,
      transcriptSnippet: transcriptSnippet || undefined,
      activeProject: projects.find(p => p.id === body.projectId)?.name || 'Default Project',
      recentClipsCount: clips.length,
      history
    });

    const cacheKey = createHash('sha256').update(`${prompt}:${body.workspaceId}:${body.clipId || ''}:${conciseContext}`).digest('hex');
    const cached = getCached(cacheKey);

    if (cached && !isStream) {
      return Response.json({ text: cached.text, actions: cached.actions, cached: true });
    }

    const workerUrl = (process.env.MEDIA_WORKER_URL || '').replace(/\/$/, '');
    if (!workerUrl) throw new Error("Media worker is not configured. Set MEDIA_WORKER_URL to enable remote processing.");
    const workerRes = await fetch(`${workerUrl}/assistant`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': process.env.MEDIA_WORKER_SECRET || '',
      },
      body: JSON.stringify({
        prompt: `You are Alpha.ai Assistant. Help with actionable video editing, hook refinement, captions, and title optimization. Keep responses clear and concise. If proposing changes, specify exact values like "recut to 12.5 - 45.0s" or "caption style: bold" or "title: 'New Title'".\n\nContext:\n${conciseContext}\n\nUser Question:\n${prompt}`,
        context: conciseContext
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!workerRes.ok) {
      throw problem('The AI assistant is temporarily unavailable. Please retry in a few seconds.', 503);
    }

    const workerData = await workerRes.json();
    const outputText = String(workerData.text || '').slice(0, 16000);
    const actions = parseActionsFromText(outputText, selectedClip);

    setCached(cacheKey, { text: outputText, actions });

    if (isStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          // Stream words in small conversational chunks
          const words = outputText.split(' ');
          let index = 0;
          const interval = setInterval(() => {
            if (index < words.length) {
              const chunk = words.slice(index, index + 3).join(' ') + ' ';
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
              index += 3;
            } else {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, actions })}\n\n`));
              clearInterval(interval);
              controller.close();
            }
          }, 30);
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        }
      });
    }

    return Response.json({ text: outputText, actions, cached: false });
  } catch (error) {
    return workflowError(error);
  }
}

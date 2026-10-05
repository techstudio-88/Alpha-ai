# Animated studio and selected-clip editing

## Workspace connections verified (2026-10-05)

- Existing Vercel project: `alpha-ai`, project ID
  `prj_nTOp7FN4FP7OeDQhty3AACX2D6RH`.
- GitHub repository: `techstudio-88/Alpha-ai`; production branch: `main`.
- Production domain: `alpha-ai-smoky.vercel.app`.
- All 11 Vercel environment entries, domain records, Git integration, and build
  configuration match the saved pre-change fingerprints. No values are printed.
- Vercel production is `READY` at `b6077726eb9abc6a7a9ef48666e25b342be914a2`.
- Render OAuth is authenticated in WSL. The existing service is
  `srv-danj4i2jnfac738qlgbg`, `alpha-ai-media-worker`, on the free Singapore Docker
  plan with repository `techstudio-88/Alpha-ai` and branch `main`.
- Render's currently live revision is `cfd7fe8852a3985a6787db51abe13f99706958f3`;
  its public health response declares worker `1.0`. It needs a coordinated release
  with the frontend before the newer worker capabilities are available.
- The Render CLI is installed at `~/.local/bin/render`; credentials are kept in
  the ignored `~/.config/render/` directory, not the repository.

## New behavior

- Staggered landing reveals, ambient hero motion, animated feature visuals, hover
  feedback, workspace transitions, dialogs, loading states, and an interactive
  assistant/editor showcase. A persistent pause control and OS reduced-motion
  preference stop decorative motion and autoplay sample timers.
- GitHub-first sign-in. Public provider options determine whether email/password
  fields are offered and whether immediate email signup is actually configured.
  OAuth errors and disabled-provider states have recovery paths.
- Workspace AI assistant with workspace/selected-clip context, title/copy guidance,
  and handoff into the editor with the requested instruction retained.
- Selected-clip assistant recognizes concrete split, caption-removal, caption
  style/color, aspect, speed, and quoted word-replacement commands. Every clause
  must be supported; mixed unsupported requests are not partially applied.
- Open-ended content-aware edits use Gemini over the actual selected timed words,
  with bounded requests and server validation. Sample mode does not call Gemini.
- Manual caption correction, word cuts, trim/in/out controls, split-at-playhead,
  split-in-half, framing, effects, edge transitions, playback speed, and zoom.
- Assistant changes and manual changes share bounded undo/redo. Multi-part drafts
  are reviewable individually and autosaved on the current device, including undo.
- Caption corrections reach timed ASS rendering and version metadata without
  rewriting the source transcript or altering speech unless a word is cut.
- Multi-part render requests validate every output before one atomic queue insert.
  One worker wake drains the persisted queue. New output clips have stable IDs for
  crash recovery; the original selected clip and its exports are preserved.
- Multiple render jobs show individual progress and terminal errors in the editor.
- Editor and assistant screens load on demand and have phone-specific layouts.

## Authentication setting requiring owner action

The latest public Supabase settings report GitHub enabled, Email disabled, and
email confirmation still enabled. Disabling the Email provider is different from
disabling confirmation. For email/password signup without a verification email,
enable Email and disable **Confirm email** in Supabase Authentication → Sign In /
Providers → Email. GitHub-only sign-in already avoids a separate email-verification
step. WSL has no Supabase management authorization; no privileged signup bypass or
production auth-setting change has been introduced.

## Checks and release requirements

- Lint, worker syntax, production build, TypeScript checks and `git diff --check`
  pass. The complete final runs passed **26 backend tests** and **54 desktop/mobile
  browser tests**.
- Backend coverage includes split/cut boundaries, caption corrections and timing,
  all-or-nothing queue submission, foreign-clip/transcript rejection, pending-render
  protection, real FFmpeg exports of both split parts, database replay, publishing
  recovery, credential encryption, and role/plan preservation.
- Browser coverage includes desktop 1440px and phone 390px, both themes, WCAG A/AA,
  assistant-to-editor handoff, split/caption editing, undo/redo, provider settings,
  motion preferences, navigation, loading/error states, and local LCP budgets.
- Local LCP measured 924 ms desktop / 480 ms mobile in the latest complete UI run;
  these are local production-build measurements, not live network measurements.
- The updated worker declares version `2.1` and the `editor-assistant`,
  `editor-batch-render`, and `caption-corrections` capabilities. Unsupported old
  workers reject capability-dependent requests before new jobs are inserted.
- Release the reviewed frontend and worker at the same Git revision. Existing
  production domains, environment values, service plans, and queue routing stay
  in place. No schema migration is needed for the new editor endpoints.
- Authenticated live source import → transcription → AI review → edited render →
  export/publish acceptance remains necessary after that coordinated deployment.
  Local fixtures do not establish live OAuth or model-output quality.
- Oracle provisioning remains paused pending Oracle account and SSH prerequisites.

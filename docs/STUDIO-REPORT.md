# Alpha.ai studio redesign report

## Delivered

- Shared graphite/lime tokens, dark default/full light palette, self-hosted Geist,
  Inter and Geist Mono, 8/14px radii, hairline borders, 120/180ms transitions, focus
  rings and reduced-motion support.
- Tailwind v4 and shadcn-style Radix primitives: Button, Input, Select, Tabs, Modal,
  Toast, Stepper, ClipCard, ScoreRing, DropZone, Timeline, Calendar, EmptyState,
  Skeleton, and reusable error states. `/design-system` provides a gallery.
- New server-rendered landing: sticky nav, interactive 60-second pipeline sample,
  source formats, three-step workflow, animated caption preview, six feature cards,
  use-case tabs, truthful pricing proposals, eight FAQs, CTA and footer.
- App screens: Home/import, Projects, project pipeline, clip review, editor, publish
  calendar/queue, Insights, Brand kit, Settings, billing/upgrade states, auth and
  onboarding. Desktop 1440px and mobile 390px have dedicated layouts.
- Real Supabase reads and existing APIs are used outside `?demo=1`. The sample workspace
  is clearly labelled and never creates real jobs, accounts, API credentials, or uploads.
- Keyboard clip review (J/K/A/E/P), bulk approval, command palette (Cmd/Ctrl K),
  collapsible sidebar, workspace switcher, activity notifications, and theme persistence.
- Editor word seeking/deletion, supported caption presets, framing/speed/zoom/effects,
  AI range instructions, draft persistence, version history, and real render requests.
- SoftwareApplication/FAQPage JSON-LD, canonical/OG metadata, refreshed OG artwork,
  and a single App Router source for robots/sitemap.
- Next loading/error/global-error boundaries, CSP, and static-only bounded SW caching.

## Verified fixes to the audit

- `const input` was already corrected to `let` in the starting checkout. Existing
  tests, ESLint, lockfiles, corrected Dockerfiles, ownership checks and worker wake
  timeouts were also already present.
- Unset cron secrets now fail closed; all cron routes use shared authorization.
- Imported originals are persisted regardless of the old 45 MB threshold.
- Direct and provider URL download paths use validation, public-address checking,
  pinned DNS, redirect validation, streamed byte bounds, and disk/deadline controls.
- Speaker analysis no longer base64-encodes the whole video, and millisecond precision
  is retained. Temporary Gemini file uploads are reused and deleted on job exit.
- Configured workers default to server transcription with per-window checkpoints.
- Default generated clips now use a vertical canvas and improved render encoding.
- Transcript cuts reach FFmpeg and compressed caption timing, rather than deleting
  source transcript rows. Cancellation and scoped manual retry actions are wired.
- Drive/Photos jobs carry encrypted canonical credentials rather than losing tokens
  in an ignored worker request body. They are cleared after source persistence.
- Publishing is single-owner, atomic-claim, streamed, and resumable. New OAuth tokens
  and refreshes are encrypted; refresh failure expires the connection.
- SW caching excludes HTML, authenticated API responses, foreign origins, and signed
  private media, and prunes static entries. Obsolete Alpha caches are removed on update.
- Session bootstrap no longer promotes existing members to owner or replaces existing
  subscription plans. Regression tests cover both privilege and plan preservation.
- PKCE session initialization no longer exchanges a consumed code twice. Password-reset
  and confirmation routes share the current accessible auth design.
- Signed clip exports, source-version URL refresh, genuine sidebar collapse, mobile
  website navigation, and richer landing feature visuals are connected.
- Worker health declares capabilities and the release revision. Worker-dependent
  credential/cut requests show a retryable update state during a rolling deployment.

## Production work still required

1. **Billing/quotas:** no payment provider, metered credit ledger, purchase flow,
   per-workspace minutes enforcement, or comprehensive API throttling is implemented.
   Proposed prices/allowances are labelled; the usage display is source duration, not
   a billed-credit meter. Per-file/job bounds do not cap total product spend.
2. **Database reproducibility/security:** core schema creation and a complete RLS/RPC
   baseline remain absent. Incremental migrations and focused tests cannot prove all
   deployed token/key permissions or rebuild staging from scratch. Production schema
   inspection also confirmed `submit_ai_chat_job` and `complete_ai_chat_plan` are
   missing. Apply `20261003_ai_video_workflow.sql` through an authorized Supabase
   migration workflow before using the transactional AI-chat APIs. The redesigned
   editor's direct AI range/render flow does not use those two RPCs.
3. **Deletion/governance:** full account/storage/provider cleanup, ownership transfers,
   content moderation/takedown, recent re-authentication and production alerting need
   dedicated backend workflows. The new UI uses a deletion-request path rather than
   advertising a complete automated purge.
4. **Provider operations:** live OAuth, private cloud imports, Gemini accuracy and
   costs, bucket upload limits, YouTube API review/privacy restrictions, and worker
   capacity/restart behavior require real-account acceptance tests. Existing plaintext
   provider records need a deliberate migration/rotation; they were not bulk changed.
5. **Advanced editing/team workflows:** decoded audio-amplitude waveforms, music,
   generated b-roll, arbitrary overlays/multi-track montage, team invitation delivery,
   richer role management, and automatically rendered brand intro/outro remain future
   work. Current speech-track bars come from transcript timing. Persisted preferences
   and unavailable features are explicitly labelled in the UI.
6. **Other audit items:** public-view counting/rate limits, public API scopes/webhooks,
   admin authorization, email-provider consolidation and infrastructure reliability
   need their own implementation and production verification. The `/contact` page is
   still a placeholder; a real support destination and deletion-request workflow are
   required before advertising a complete support service.

## Deployment boundary

The workspace is linked to the existing Vercel `alpha-ai` project and
`techstudio-88/Alpha-ai` repository. The owner authorized a reviewed commit/push to
`main` and a coordinated production release. The existing domain and Vercel environment
variables are preserved; no database migrations are needed for these frontend changes.
Render and Vercel must deploy the same main revision. Worker-dependent calls check
capabilities and report an update state until the updated worker is ready.

## Checks

Run the commands in the README. Backend tests include real FFmpeg output and a real
PostgreSQL-WASM transaction migration, plus publishing race/session recovery fixtures.
Browser checks cover 1440/390px layouts, axe WCAG A/AA scans, keyboard interactions,
theme persistence, reduced motion, state handling and local production-build LCP.
Sample screenshots are generated outside the repo in `/tmp/omnirush`.
Local performance measurements do not establish production performance on real networks.

The follow-up verification passed 18 backend tests and 36 desktop/mobile browser checks,
plus 6 navigation/auth/release checks. Local cold-load LCP was 796 ms at 1440px
and 1260 ms at 390px. The production schema exposes the required studio tables and
workflow RPCs, and the `media` bucket is private. These read-only checks do not substitute
for a complete audit of deployed RLS policies.

Final local verification: **16 backend tests passed; 36 browser tests passed**, plus
lint, type checking, syntax checks, production build and `git diff --check`. Automated
axe checks found no WCAG A/AA violations in the tested 1440/390px views. Latest local
production-build LCP measurements were **492 ms desktop / 632 ms mobile**; the
illustrated hero asset is under 200 KB. Live provider/account testing remains in the
deployment acceptance steps.

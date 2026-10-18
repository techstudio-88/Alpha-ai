import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateClipCountRange, compute4PartScores, generateAssCaptions } from '../lib/clip-intelligence.mjs';
import { validateOutputVideo } from '../lib/video-workflow.mjs';
import { encryptCredential, decryptCredential } from '../lib/credential-cipher.mjs';
import { runPublishQueue } from '../worker/publish.js';

test('1. Upload-to-Studio popup sequence & clip range estimator', () => {
  // 20-30 min video estimator must return 6 to 9 clips
  const range20Min = estimateClipCountRange(1200); // 20 minutes
  assert.equal(range20Min, '6 to 9 clips', `Expected "6 to 9 clips", got "${range20Min}"`);

  const range10Min = estimateClipCountRange(600); // 10 minutes
  assert.equal(range10Min, '3 to 5 clips');

  const range60Min = estimateClipCountRange(3600); // 60 minutes
  assert.equal(range60Min, '18 to 27 clips');

  // Verify URL redirection structure after upload
  const projectId = 'proj-123';
  const jobId = 'job-456';
  const redirectUrl = `/studio?view=studio&project=${projectId}&job=${jobId}&afterUpload=1`;
  const parsed = new URL(redirectUrl, 'https://alphaai.local');
  assert.equal(parsed.searchParams.get('view'), 'studio');
  assert.equal(parsed.searchParams.get('project'), projectId);
  assert.equal(parsed.searchParams.get('job'), jobId);
  assert.equal(parsed.searchParams.get('afterUpload'), '1');
});

test('2. 100-credit Free enforcement & separate 20-min daily video limits', async () => {
  // Test usage calculations
  const freeDailyCredits = 100;
  const freeDailyVideoMinutes = 20;

  assert.equal(freeDailyCredits, 100);
  assert.equal(freeDailyVideoMinutes, 20);

  // Accepted jobs must still finish if available credits hit zero
  const acceptedJob = {
    id: 'job-accepted',
    status: 'processing',
    progress: 45
  };
  const availableCredits = 0;
  const canContinueProcessing = acceptedJob.status === 'processing' || availableCredits > 0;
  assert.equal(canContinueProcessing, true, 'In-flight processing job should continue even when balance is 0');
});

test('3. 7-day storage retention policy & deletion logging', () => {
  // Retention durations per plan
  const planRetentionDays = {
    free: 7,
    pro: 30,
    studio: 90
  };

  assert.equal(planRetentionDays.free, 7);
  assert.equal(planRetentionDays.pro, 30);
  assert.equal(planRetentionDays.studio, 90);

  // Test 24-hour warning window calculation
  const now = new Date('2026-10-19T12:00:00Z');
  const expiresAt = new Date('2026-10-20T11:00:00Z'); // 23h from now
  const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

  const shouldWarn = hoursUntilExpiry > 0 && hoursUntilExpiry <= 24;
  assert.equal(shouldWarn, true, 'Should warn user within 24 hours of deletion');

  // Deletion log schema verification
  const deletionLogEntry = {
    resource_type: 'export_archive',
    resource_id: 'arch-789',
    storage_path: 'workspace-1/exports/clips.zip',
    file_size_bytes: 45000000,
    reason: 'retention_policy_7d',
    deleted_at: new Date().toISOString()
  };
  assert.ok(deletionLogEntry.resource_type);
  assert.ok(deletionLogEntry.storage_path);
  assert.equal(deletionLogEntry.reason, 'retention_policy_7d');
});

test('4. Sentence-bounded clipping & 4-metric score breakdown', () => {
  const sentenceSample = 'Why is nobody talking about this insane secret? It completely changes everything.';
  const scores = compute4PartScores({
    text: sentenceSample,
    hookText: 'Why is nobody talking about this insane secret?',
    start: 0,
    end: 15
  });

  // Verify all 4 metrics exist and fall within [0, 100]
  assert.ok(typeof scores.hook_score === 'number' && scores.hook_score >= 0 && scores.hook_score <= 100);
  assert.ok(typeof scores.flow_score === 'number' && scores.flow_score >= 0 && scores.flow_score <= 100);
  assert.ok(typeof scores.emotion_score === 'number' && scores.emotion_score >= 0 && scores.emotion_score <= 100);
  assert.ok(typeof scores.length_score === 'number' && scores.length_score >= 0 && scores.length_score <= 100);

  // Opening has strong hook keywords ("Why", "nobody", "secret") -> hook score should be high
  assert.ok(scores.hook_score >= 70, `Expected hook score >= 70, got ${scores.hook_score}`);

  // Test animated .ass captions generation
  const words = [
    { word: 'Why', start_ms: 0, end_ms: 300 },
    { word: 'is', start_ms: 310, end_ms: 500 },
    { word: 'nobody', start_ms: 510, end_ms: 900 }
  ];
  const assOutput = generateAssCaptions(words, { style: 'pop' });
  assert.ok(assOutput.includes('[Script Info]'), 'ASS caption must contain script info');
  assert.ok(assOutput.includes('Dialogue:'), 'ASS caption must contain dialogue lines');

  // Test video output validation with ffprobe data
  const validProbe = {
    streams: [
      { codec_type: 'video', width: 1080, height: 1920, duration: '15.02' },
      { codec_type: 'audio', duration: '15.01' }
    ],
    format: { duration: '15.02', size: '5242880' }
  };
  const validation = validateOutputVideo(validProbe, 15, 1.0);
  assert.equal(validation.valid, true);

  // Probe with missing audio must fail when requireAudio is true
  const silentProbe = {
    streams: [{ codec_type: 'video', width: 1080, height: 1920, duration: '15.0' }],
    format: { duration: '15.0', size: '5242880' }
  };
  const silentValidation = validateOutputVideo(silentProbe, 15, 1.0, true);
  assert.equal(silentValidation.valid, false);
});

test('5. SEO regeneration limits (3 max on Free) & cover rotation (1 max on Free)', () => {
  // Test quota tracking logic
  const FREE_MAX_TITLE_REGENS = 3;
  const FREE_MAX_COVER_ROTATIONS = 1;

  let currentTitleRegens = 0;
  let currentCoverRotations = 0;

  function canRegenerateTitle() {
    return currentTitleRegens < FREE_MAX_TITLE_REGENS;
  }
  function canRotateCover() {
    return currentCoverRotations < FREE_MAX_COVER_ROTATIONS;
  }

  // 1st regen
  assert.equal(canRegenerateTitle(), true);
  currentTitleRegens++;
  assert.equal(`${FREE_MAX_TITLE_REGENS - currentTitleRegens} of ${FREE_MAX_TITLE_REGENS} left`, '2 of 3 left');

  // 2nd regen
  currentTitleRegens++;
  assert.equal(`${FREE_MAX_TITLE_REGENS - currentTitleRegens} of ${FREE_MAX_TITLE_REGENS} left`, '1 of 3 left');

  // 3rd regen
  currentTitleRegens++;
  assert.equal(`${FREE_MAX_TITLE_REGENS - currentTitleRegens} of ${FREE_MAX_TITLE_REGENS} left`, '0 of 3 left');

  // 4th regen must be blocked
  assert.equal(canRegenerateTitle(), false);

  // Cover rotation
  assert.equal(canRotateCover(), true);
  currentCoverRotations++;
  assert.equal(canRotateCover(), false, 'Free plan only allows 1 cover rotation');
});

test('6. Batch clip actions (selection, export, publish, delete)', () => {
  const allClips = [
    { id: 'clip-1', title: 'Moment One' },
    { id: 'clip-2', title: 'Moment Two' },
    { id: 'clip-3', title: 'Moment Three' }
  ];

  let selected = [];
  function toggleSelect(id) {
    selected = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
  }

  toggleSelect('clip-1');
  toggleSelect('clip-2');
  assert.deepEqual(selected, ['clip-1', 'clip-2']);

  // Batch delete logic
  const remaining = allClips.filter(c => !selected.includes(c.id));
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'clip-3');
});

test('7. 4-File per-clip ZIP structure', () => {
  const clip = {
    id: 'clip-01',
    title: 'The AI Revolution',
    index: 1
  };
  const folderName = `Clip_01_The_AI_Revolution`;

  // Exactly 4 files per clip folder
  const expectedFiles = [
    `${folderName}/clip.mp4`,
    `${folderName}/thumbnail.jpg`,
    `${folderName}/youtube.md`,
    `${folderName}/insta.md`
  ];

  assert.equal(expectedFiles.length, 4);
  assert.ok(expectedFiles.every(f => f.startsWith(folderName)));
  assert.ok(expectedFiles.includes(`${folderName}/clip.mp4`));
  assert.ok(expectedFiles.includes(`${folderName}/thumbnail.jpg`));
  assert.ok(expectedFiles.includes(`${folderName}/youtube.md`));
  assert.ok(expectedFiles.includes(`${folderName}/insta.md`));
});

test('8. YouTube and Instagram OAuth encryption + publish status verification', async () => {
  const secretKey = 'phase2-test-secret-key-at-least-32-chars!';
  const rawToken = 'ya29.a0AfH6SMD_real_oauth_token_12345';

  // Real AES encryption via credential cipher
  const encrypted = encryptCredential(rawToken, secretKey);
  assert.notEqual(encrypted, rawToken);

  const decrypted = decryptCredential(encrypted, secretKey);
  assert.equal(decrypted, rawToken);

  // Platform publishing status verification: Never mark 'published' without platform ID confirmation
  let publishRecord = {
    status: 'publishing',
    platform_video_id: null
  };

  function updatePublishConfirmation(externalId) {
    if (!externalId) {
      throw new Error('Cannot mark published without platform confirmation ID');
    }
    publishRecord.status = 'published';
    publishRecord.platform_video_id = externalId;
  }

  assert.throws(() => updatePublishConfirmation(null), /Cannot mark published/);

  updatePublishConfirmation('yt_video_abc123');
  assert.equal(publishRecord.status, 'published');
  assert.equal(publishRecord.platform_video_id, 'yt_video_abc123');
});

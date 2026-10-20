import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeoModelResponse } from '../lib/seo-assets.mjs';
test('mocked model response parses JSON and repairs trailing commas', () => {
  const mockedModelResponse = { candidates: [{ content: { parts: [{ text: '{"hook":"A strong opening","title":"Creator title","caption":"Useful summary","hashtags":["#video","#AI",],"youtube_description":"Description","instagram_caption":"Caption","thumbnail_prompt":"Bright portrait",}' }] } }] };
  const assets = parseSeoModelResponse(mockedModelResponse, 'Fallback title');
  assert.equal(assets.hook, 'A strong opening'); assert.equal(assets.title, 'Creator title');
  assert.deepEqual(assets.hashtags, ['video', 'AI']); assert.equal(assets.youtube_description, 'Description');
  assert.equal(assets.instagram_caption, 'Caption'); assert.equal(assets.thumbnail_prompt, 'Bright portrait');
});
test('SEO parser rejects missing or malformed model output with a retryable error', () => {
  assert.throws(() => parseSeoModelResponse({ text: 'not json' }), /structured SEO data/);
  assert.throws(() => parseSeoModelResponse({ text: '{bad json}' }), /invalid SEO JSON/);
});

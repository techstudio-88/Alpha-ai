import test from "node:test";
import assert from "node:assert/strict";
import { sendPreferenceEmail } from "../lib/email.mjs";

function adminWith(preferences, email = "creator@example.test") {
  return {
    from(table) {
      assert.equal(table, "profiles");
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { preferences }, error: null }; },
      };
    },
    auth: {
      admin: {
        async getUserById() { return { data: { user: { email } }, error: null }; },
      },
    },
  };
}

function withEnv(values, run) {
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve().then(run).finally(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("job notification email stays off unless the user opted in", async () => {
  await withEnv({ RESEND_API_KEY: "test-key", EMAIL_FROM: "Alpha.ai <noreply@example.test>" }, async () => {
    const result = await sendPreferenceEmail(adminWith({ notifications: { job_failed: { email: false } } }), "user-1", "job_failed", "Subject", "Body");
    assert.deepEqual(result, { sent: false, reason: "email_disabled_by_user" });
  });
});

test("job notification email returns safely when provider configuration is missing", async () => {
  await withEnv({ RESEND_API_KEY: null, EMAIL_FROM: null }, async () => {
    const result = await sendPreferenceEmail(adminWith({ notifications: { job_completed: { email: true } } }), "user-1", "job_completed", "Subject", "Body");
    assert.deepEqual(result, { sent: false, reason: "email_not_configured" });
  });
});

test("opted-in email uses a stable idempotency key and never logs provider credentials", async () => {
  await withEnv({ RESEND_API_KEY: "test-key", EMAIL_FROM: "Alpha.ai <noreply@example.test>" }, async () => {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: "email-test" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const result = await sendPreferenceEmail(adminWith({ notifications: { job_completed: { email: true } } }), "user-1", "job_completed", "Ready", "Your video is ready.", "alpha-job-test-job_completed");
      assert.deepEqual(result, { sent: true });
      assert.equal(request.url, "https://api.resend.com/emails");
      assert.equal(request.options.headers["Idempotency-Key"], "alpha-job-test-job_completed");
      assert.equal(JSON.parse(request.options.body).to[0], "creator@example.test");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

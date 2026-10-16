export function readGeminiKeys(env = process.env) {
  const candidates = [];
  const add = (label, value) => {
    const key = String(value || "").trim();
    if (key && !candidates.some((entry) => entry.key === key)) candidates.push({ label, key });
  };
  add("GEMINI_API_KEY", env.GEMINI_API_KEY);
  for (let i = 1; i <= 5; i += 1) add("GEMINI_API_KEY_" + i, env["GEMINI_API_KEY_" + i]);
  String(env.GEMINI_API_KEYS || "").split(",").forEach((key, i) => add("GEMINI_API_KEYS_" + (i + 1), key));
  return candidates;
}

export function createGeminiKeyRing(env = process.env) {
  const keys = readGeminiKeys(env);
  let cursor = 0;
  const cooldowns = new Map();
  return {
    keys,
    next(now = Date.now()) {
      if (!keys.length) return null;
      const available = keys.filter((entry) => (cooldowns.get(entry.label) || 0) <= now);
      const pool = available.length ? available : [...keys].sort((a, b) => (cooldowns.get(a.label) || 0) - (cooldowns.get(b.label) || 0)).slice(0, 1);
      const value = pool[cursor % pool.length];
      cursor = (cursor + 1) % Math.max(1, pool.length);
      return value;
    },
    markUnavailable(label, cooldownMs = 60000, now = Date.now()) {
      if (keys.some((entry) => entry.label === label)) cooldowns.set(label, now + Math.max(1000, cooldownMs));
    },
    markAvailable(label) {
      cooldowns.delete(label);
    },
    current() {
      return keys[0] || null;
    }
  };
}

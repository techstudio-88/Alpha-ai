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
  return {
    keys,
    next() {
      if (!keys.length) return null;
      const value = keys[cursor % keys.length];
      cursor = (cursor + 1) % keys.length;
      return value;
    },
    current() {
      return keys[0] || null;
    }
  };
}

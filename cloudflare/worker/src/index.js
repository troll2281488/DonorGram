import { createRemoteJWKSet, jwtVerify } from "jose";

const PROJECT_ID = "donor-fd6ea";
const FIREBASE_ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const FIREBASE_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);
const ALLOWED_ORIGINS = new Set([
  "https://troll2281488.github.io",
  "http://localhost:5173"
]);

function cors(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://troll2281488.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin"
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin);
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return Response.json({ error: "Origin is not allowed." }, { status: 403, headers });
    }
    if (request.method !== "POST") return Response.json({ error: "Use POST." }, { status: 405, headers });
    if (!env.OFOX_API_KEY) return Response.json({ error: "Server secret OFOX_API_KEY is missing." }, { status: 503, headers });

    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return Response.json({ error: "Sign in to DonorGram first." }, { status: 401, headers });
    let uid;
    try {
      const verified = await jwtVerify(token, FIREBASE_KEYS, {
        issuer: FIREBASE_ISSUER,
        audience: PROJECT_ID
      });
      uid = verified.payload.sub;
      if (!uid) throw new Error("Missing uid");
    } catch {
      return Response.json({ error: "Firebase session is invalid. Sign in again." }, { status: 401, headers });
    }

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt || prompt.length > 6000) {
      return Response.json({ error: "Prompt must contain 1–6000 characters." }, { status: 400, headers });
    }

    // Simple per-isolate throttle; configure Cloudflare rate limiting for stronger global quotas.
    const now = Date.now();
    const slot = Math.floor(now / 60000);
    const key = `rate:${uid}:${slot}`;
    const used = Number(await env.DONAI_LIMITS.get(key) || "0");
    if (used >= 8) return Response.json({ error: "Лимит DonAI: не больше 8 запросов в минуту." }, { status: 429, headers });
    await env.DONAI_LIMITS.put(key, String(used + 1), { expirationTtl: 120 });

    let upstream;
    try {
      upstream = await fetch("https://api.ofox.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OFOX_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.OFOX_MODEL || "openai/gpt-4o",
          messages: [
            { role: "system", content: "Ты DonAI — помощник внутри мессенджера DonorGram. Отвечай на русском, если пользователь пишет по-русски. Будь точным и честным." },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 1200
        }),
        signal: AbortSignal.timeout(45000)
      });
    } catch {
      return Response.json({ error: "Не удалось связаться с OfoxAI." }, { status: 502, headers });
    }
    if (!upstream.ok) {
      const status = upstream.status;
      return Response.json({
        error: status === 401 || status === 403
          ? "OfoxAI отклонил ключ. Проверь OFOX_API_KEY."
          : status === 429 ? "OfoxAI ограничил запросы или баланс исчерпан." : `OfoxAI вернул ошибку ${status}.`
      }, { status: status === 429 ? 429 : 502, headers });
    }
    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content;
    const answer = typeof content === "string"
      ? content
      : Array.isArray(content) ? content.map((part) => part.text || "").join("") : "";
    if (!answer.trim()) return Response.json({ error: "OfoxAI вернул пустой ответ." }, { status: 502, headers });
    return Response.json({ answer: answer.slice(0, 12000) }, { headers });
  }
};

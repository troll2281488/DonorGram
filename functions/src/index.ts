import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();
const db = getFirestore();
const ofoxKey = defineSecret("OFOX_API_KEY");

export const askDonAI = onCall(
  { region: "us-central1", secrets: [ofoxKey], timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Войди в DonorGram.");
    const prompt = typeof request.data?.prompt === "string" ? request.data.prompt.trim() : "";
    if (!prompt) throw new HttpsError("invalid-argument", "Напиши вопрос для DonAI.");
    if (prompt.length > 6000) throw new HttpsError("invalid-argument", "Слишком длинный запрос (максимум 6000 символов).");

    const uid = request.auth.uid;
    const rateRef = db.collection("donaiRateLimits").doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(rateRef);
      const now = Date.now();
      const windowStart = snap.exists ? Number(snap.get("windowStart") || 0) : 0;
      const count = snap.exists ? Number(snap.get("count") || 0) : 0;
      if (now - windowStart < 60_000 && count >= 8) {
        throw new HttpsError("resource-exhausted", "Лимит DonAI: не больше 8 запросов в минуту.");
      }
      tx.set(rateRef, {
        windowStart: now - windowStart < 60_000 ? windowStart : now,
        count: now - windowStart < 60_000 ? count + 1 : 1,
        updatedAt: Timestamp.now()
      });
    });

    const key = ofoxKey.value();
    if (!key) throw new HttpsError("failed-precondition", "На сервере не задан секрет OFOX_API_KEY.");
    let response: Response;
    try {
      response = await fetch("https://api.ofox.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-4o",
          messages: [
            { role: "system", content: "Ты DonAI — дружелюбный помощник внутри приватного мессенджера DonorGram. Отвечай на русском, если пользователь пишет по-русски. Будь точным и честным." },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 1200
        }),
        signal: AbortSignal.timeout(45_000)
      });
    } catch {
      throw new HttpsError("unavailable", "Не удалось связаться с OfoxAI. Попробуй позже.");
    }
    if (!response.ok) {
      const status = response.status;
      if (status === 401 || status === 403) throw new HttpsError("failed-precondition", "OfoxAI отклонил ключ. Проверь секрет OFOX_API_KEY.");
      if (status === 429) throw new HttpsError("resource-exhausted", "У OfoxAI превышен лимит запросов или средств.");
      throw new HttpsError("unavailable", `OfoxAI вернул ошибку ${status}.`);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{type?:string;text?:string}> } }> };
    const content = payload.choices?.[0]?.message?.content;
    const answer = typeof content === "string"
      ? content
      : Array.isArray(content) ? content.map((part) => part.text || "").join("") : "";
    if (!answer.trim()) throw new HttpsError("internal", "OfoxAI вернул пустой ответ.");
    return { answer: answer.slice(0, 12000) };
  }
);

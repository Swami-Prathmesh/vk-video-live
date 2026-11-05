/**
 * VK Video Live — Cloudflare Worker backend
 * ---------------------------------------------------------------
 * Three endpoints:
 *   GET  /api/search?q=&lang=      query -> Russian -> VK video.search -> titles back to `lang`
 *   GET  /api/captions?oid=&id=&lang=  VK video -> audio -> speech-to-text -> translated cues
 *   POST /api/translate            { text, from, to }  generic translation
 *   GET  /api/health               env sanity check
 *
 * Env (set with `wrangler secret put ...`):
 *   VK_ACCESS_TOKEN        service/user token with the `video` scope
 *   SARVAM_API_KEY         https://dashboard.sarvam.ai  (Indic languages + English)
 *   GOOGLE_TRANSLATE_KEY   optional — needed for the Russian leg (Google Cloud Translation v2)
 *   YANDEX_TRANSLATE_KEY   optional — alternative for the Russian leg
 *
 * Sarvam covers 22 Indian languages + English. Russian is not in that set, so
 * the Russian hop is routed to Google or Yandex. If neither key is present the
 * worker still searches (VK matches Russian text well) but skips query translation.
 */

const SARVAM_CODE = {
  en: "en-IN", hi: "hi-IN", mr: "mr-IN", gu: "gu-IN", bn: "bn-IN",
  ta: "ta-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", pa: "pa-IN",
  or: "od-IN", as: "as-IN", ur: "ur-IN", ru: "ru-RU",
};

const VK_VERSION = "5.199";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

function bad(msg, status = 400) {
  return json({ error: msg }, status);
}

async function vk(method, params, env) {
  if (!env.VK_ACCESS_TOKEN) throw new Error("VK_ACCESS_TOKEN is not set");
  const qs = new URLSearchParams({ ...params, access_token: env.VK_ACCESS_TOKEN, v: VK_VERSION });
  const res = await fetch(`https://api.vk.com/method/${method}?${qs}`, {
    headers: { "user-agent": "vk-video-live/1.0" },
  });
  const body = await res.json().catch(() => ({}));
  if (body.error) {
    throw new Error(`VK ${method}: ${body.error.error_msg} (code ${body.error.error_code})`);
  }
  return body.response;
}

/* ---- translation: Sarvam for Indic, Google/Yandex for Russian ---- */

async function sarvamTranslate(text, from, to, env) {
  const res = await fetch("https://api.sarvam.ai/translate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-subscription-key": env.SARVAM_API_KEY,
    },
    body: JSON.stringify({
      input: text,
      source_language_code: SARVAM_CODE[from] || "auto",
      target_language_code: SARVAM_CODE[to] || "en-IN",
      speaker_gender: "Male",
      mode: "formal",
      model: "mayura:v1",
      numerals_format: "international",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sarvam: ${body.message || res.status}`);
  return body.translated_text;
}

async function googleTranslate(text, from, to, env) {
  const qs = new URLSearchParams({
    q: text,
    target: to,
    format: "text",
    key: env.GOOGLE_TRANSLATE_KEY,
  });
  if (from) qs.set("source", from);
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?${qs}`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Translate: ${JSON.stringify(body.error?.message || res.status)}`);
  return body.data.translations[0].translatedText;
}

async function yandexTranslate(text, from, to, env) {
  const qs = new URLSearchParams({ text, lang: `${from || ""}-${to}`, format: "plain" });
  const res = await fetch(`https://translate.yandex.net/api/v1.5/tr.json/translate?${qs}&key=${env.YANDEX_TRANSLATE_KEY}`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Yandex Translate: ${body.message || res.status}`);
  return body.text[0];
}

async function selfHostedTranslate(text, from, to, env) {
  const res = await fetch(`${env.MT_BASE.replace(/\/$/, "")}/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, source: from, target: to }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`MT_BASE: ${body.detail || res.status}`);
  return body.text;
}

async function translate(text, from, to, env) {
  if (!text) return "";

  // 0. a self-hosted open-source model wins over every paid API:
  //    free, unlimited, no quota. See /server (NLLB-200 or IndicTrans2).
  if (env.MT_BASE) {
    try {
      return await selfHostedTranslate(text, from, to, env);
    } catch (e) {
      console.warn("MT_BASE failed, falling back:", e.message);
    }
  }

  const needsRussian = from === "ru" || to === "ru";
  if (needsRussian) {
    if (env.GOOGLE_TRANSLATE_KEY) return googleTranslate(text, from, to, env);
    if (env.YANDEX_TRANSLATE_KEY) return yandexTranslate(text, from, to, env);
    // No Russian-capable provider configured: return the text unchanged so the
    // UI still works instead of failing the whole request.
    return text;
  }
  if (!env.SARVAM_API_KEY) return text;
  return sarvamTranslate(text, from, to, env);
}

/* ---- speech to text ---- */

/**
 * Sarvam speech-to-text-translate: Russian audio -> English text + word timings.
 * Then the English text is translated into the requested Indian language.
 * Long videos are chunked; each chunk keeps its own offset on the timeline.
 */
async function transcribeAudio(buffer, mime, env) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime || "audio/mp4" }), "audio.m4a");
  form.append("model", "saaras:v2.5");
  form.append("with_timestamps", "true");

  const res = await fetch("https://api.sarvam.ai/speech-to-text-translate", {
    method: "POST",
    headers: { "api-subscription-key": env.SARVAM_API_KEY },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sarvam STT: ${body.message || res.status}`);
  return body;
}

/** Turn word-level timings into readable cues (max ~9 words / ~7 seconds). */
function wordsToCues(words, starts, ends, chunkDuration) {
  const cues = [];
  if (!Array.isArray(words) || !words.length) return cues;
  let buf = [], t0 = starts[0], t1 = starts[0];
  for (let i = 0; i < words.length; i++) {
    if (!buf.length) t0 = starts[i];
    buf.push(words[i]);
    t1 = ends[i];
    const long = t1 - t0 > 7;
    const many = buf.length >= 9;
    const sentenceEnd = /[.!?।]$/.test(words[i]);
    if (long || many || sentenceEnd) {
      cues.push({ start: t0, end: t1 + 0.25, text: buf.join(" ") });
      buf = [];
    }
  }
  if (buf.length) cues.push({ start: t0, end: Math.max(t1, chunkDuration || t1), text: buf.join(" ") });
  return cues;
}

/** Even split fallback when the provider gives no timings. */
function spreadCues(text, duration) {
  const parts = String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const n = parts.length || 1;
  const step = (duration || n * 4) / n;
  return parts.map((p, i) => ({ start: i * step, end: (i + 1) * step, text: p }));
}

/* ------------------------------------------------------------------ */
/* request handlers                                                    */
/* ------------------------------------------------------------------ */

async function handleSearch(url, env) {
  const q = (url.searchParams.get("q") || "").trim();
  const lang = url.searchParams.get("lang") || "en";
  if (!q) return bad("q is required");

  // 1. translate the user's query into Russian
  let queryRu = q;
  try {
    queryRu = await translate(q, lang, "ru", env);
  } catch (e) {
    console.warn("query translation failed:", e.message);
  }

  // 2. search VK
  let resp;
  try {
    resp = await vk("video.search", { q: queryRu, count: "24", sort: "2", hd: "1" }, env);
  } catch (e) {
    return json({ error: e.message, queryRu, results: [] }, 502);
  }

  const items = (resp.items || []).filter((v) => v && v.id && v.owner_id != null);

  // 3. translate titles back (best effort, in parallel)
  const results = await Promise.all(
    items.map(async (v) => {
      const original = v.title || "";
      let title = original;
      try {
        title = await translate(original, "ru", lang, env);
      } catch (_) {}
      return {
        id: String(v.id),
        oid: String(v.owner_id),
        title,
        titleOriginal: original,
        channel: v.owner_id < 0 ? `club${Math.abs(v.owner_id)}` : `id${v.owner_id}`,
        duration: v.duration || 0,
        thumb: v.image?.[v.image.length - 1]?.url || v.photo_320 || "",
        embed: `https://vk.com/video_ext.php?oid=${v.owner_id}&id=${v.id}&hd=2`,
      };
    })
  );

  return json({ query: q, queryRu, lang, results }, 200, {
    "cache-control": "public, max-age=300",
  });
}

async function handleCaptions(url, env, ctx) {
  const id = url.searchParams.get("id");
  const oid = url.searchParams.get("oid");
  const lang = url.searchParams.get("lang") || "hi";
  if (!id) return bad("id is required");
  if (!env.SARVAM_API_KEY) return bad("SARVAM_API_KEY is not configured on the worker", 503);

  const cacheKey = new Request(`https://cache.local/captions/${oid}_${id}_${lang}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    // 1. find a playable file
    const vkId = oid ? `${oid}_${id}` : id;
    const got = await vk("video.get", { videos: vkId }, env);
    const video = got.items?.[0];
    if (!video) return bad("video not found or not accessible with this token", 404);

    const files = video.files || {};
    const media =
      files.mp4_240 || files.mp4_360 || files.mp4_480 || files.mp4_720 || files.mp4_1080 || files.external;
    if (!media) {
      return json({ cues: [], error: "No downloadable audio for this video (it may be a live stream or geo-blocked)." }, 200);
    }

    // 2. pull the audio track (small renditions keep memory inside the Worker limit)
    const mediaRes = await fetch(media, { headers: { "user-agent": "vk-video-live/1.0" } });
    if (!mediaRes.ok) throw new Error(`media fetch failed: ${mediaRes.status}`);
    const buffer = await mediaRes.arrayBuffer();

    // 3. transcribe (Russian audio -> English) + timings
    const stt = await transcribeAudio(buffer, mediaRes.headers.get("content-type"), env);
    const duration = video.duration || 0;
    const words = stt.timestamps?.words;
    const starts = stt.timestamps?.start_time_seconds;
    const ends = stt.timestamps?.end_time_seconds;

    let raw = Array.isArray(words) && words.length
      ? wordsToCues(words, starts, ends, duration)
      : spreadCues(stt.transcript || "", duration);

    if (!raw.length) {
      return json({ cues: [], error: "No speech detected in this video." }, 200);
    }

    // 4. translate each cue into the requested language
    const cues = await Promise.all(
      raw.map(async (c) => {
        let dst = c.text;
        try {
          dst = await translate(c.text, "en", lang, env);
        } catch (_) {}
        return { start: c.start, end: c.end, src: c.text, dst };
      })
    );

    const body = json({ engine: "asr", targetLang: lang, cues }, 200, {
      "cache-control": "public, max-age=86400",
    });
    ctx.waitUntil(cache.put(cacheKey, body.clone()));
    return body;
  } catch (e) {
    return json({ cues: [], error: e.message }, 502);
  }
}

async function handleTranslate(request, env) {
  const body = await request.json().catch(() => ({}));
  const { text, from = "ru", to = "hi" } = body;
  if (!text) return bad("text is required");
  try {
    const out = await translate(text, from, to, env);
    return json({ text: out, from, to });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      switch (url.pathname) {
        case "/api/health":
          return json({
            ok: true,
            vk: !!env.VK_ACCESS_TOKEN,
            sarvam: !!env.SARVAM_API_KEY,
            russianProvider: env.GOOGLE_TRANSLATE_KEY ? "google" : env.YANDEX_TRANSLATE_KEY ? "yandex" : "none",
          });
        case "/api/search":
          return await handleSearch(url, env);
        case "/api/captions":
          return await handleCaptions(url, env, ctx);
        case "/api/translate":
          if (request.method !== "POST") return bad("POST required", 405);
          return await handleTranslate(request, env);
        case "/":
          return new Response("VK Video Live API. Try /api/health", { headers: { "content-type": "text/plain", ...CORS } });
        default:
          return bad("not found", 404);
      }
    } catch (e) {
      return json({ error: e.message || String(e) }, 500);
    }
  },
};

/**
 * VK Video Live — Cloudflare Worker backend
 * ---------------------------------------------------------------
 *   GET  /api/transcript?url=&lang=&stream=1   paste-a-link -> live cues (SSE)
 *   GET  /api/captions?oid=&id=&lang=          same, JSON, for older clients
 *   GET  /api/search?q=&lang=                  VK search (kept for completeness)
 *   POST /api/translate                        { text, from, to }
 *   GET  /api/health
 *
 * Env (wrangler secret put ...):
 *   VK_ACCESS_TOKEN        VK service/user token with the `video` scope
 *   MT_BASE                self-hosted open-source MT (free + unlimited), see /server
 *   SARVAM_API_KEY         fallback STT + Indic translation
 *   GOOGLE_TRANSLATE_KEY   or YANDEX_TRANSLATE_KEY — for the Russian leg
 */

const SARVAM_CODE = {
  en: "en-IN", hi: "hi-IN", mr: "mr-IN", gu: "gu-IN", bn: "bn-IN",
  ta: "ta-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", pa: "pa-IN",
  or: "od-IN", as: "as-IN", ur: "ur-IN", ru: "ru-RU",
};

const VK_VERSION = "5.199";

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
function bad(msg, status = 400) { return json({ error: msg }, status); }

/* ------------------------------------------------------------------ */
/* link parsing                                                        */
/* ------------------------------------------------------------------ */

export function parseLink(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;

  if (/\.(mp4|webm|m4v|mov|ogg|mp3|m4a|wav)(\?|#|$)/i.test(s)) return { kind: "file", src: s };

  const ext = s.match(/video_ext\.php\?.*?\boid=(-?\d+).*?\bid=(\d+)/i);
  if (ext) return { kind: "vk", oid: ext[1], id: ext[2] };

  const pair = s.match(/\/(?:video|clip)(-?\d+)_(\d+)/i);
  if (pair) return { kind: "vk", oid: pair[1], id: pair[2] };

  const single = s.match(/\/video(\d{6,})/i);
  if (single) return { kind: "vk", oid: null, id: single[1] };

  return { kind: "unknown", src: s };
}

/* ------------------------------------------------------------------ */
/* VK + translation                                                    */
/* ------------------------------------------------------------------ */

async function vk(method, params, env) {
  if (!env.VK_ACCESS_TOKEN) throw new Error("VK_ACCESS_TOKEN is not set");
  const qs = new URLSearchParams({ ...params, access_token: env.VK_ACCESS_TOKEN, v: VK_VERSION });
  const res = await fetch(`https://api.vk.com/method/${method}?${qs}`, {
    headers: { "user-agent": "vk-video-live/1.0" },
  });
  const body = await res.json().catch(() => ({}));
  if (body.error) throw new Error(`VK ${method}: ${body.error.error_msg} (code ${body.error.error_code})`);
  return body.response;
}

async function sarvamTranslate(text, from, to, env) {
  const res = await fetch("https://api.sarvam.ai/translate", {
    method: "POST",
    headers: { "content-type": "application/json", "api-subscription-key": env.SARVAM_API_KEY },
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
  const qs = new URLSearchParams({ q: text, target: to, format: "text", key: env.GOOGLE_TRANSLATE_KEY });
  if (from) qs.set("source", from);
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?${qs}`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Translate: ${body.error?.message || res.status}`);
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
  if (env.MT_BASE) {
    try {
      return await selfHostedTranslate(text, from, to, env);
    } catch (e) {
      console.warn("MT_BASE failed, falling back:", e.message);
    }
  }
  if (from === "ru" || to === "ru") {
    if (env.GOOGLE_TRANSLATE_KEY) return googleTranslate(text, from, to, env);
    if (env.YANDEX_TRANSLATE_KEY) return yandexTranslate(text, from, to, env);
    return text;
  }
  if (!env.SARVAM_API_KEY) return text;
  return sarvamTranslate(text, from, to, env);
}

/* ------------------------------------------------------------------ */
/* media resolution + speech                                           */
/* ------------------------------------------------------------------ */

async function resolveMedia(parsed, env) {
  if (parsed.kind === "file") {
    return { media: parsed.src, embed: null, title: null, duration: 0, oid: null, id: null };
  }
  if (parsed.kind !== "vk") throw new Error("Unsupported link");
  if (!parsed.oid) throw new Error("That VK link has no owner id. Use a link like vkvideo.ru/video-123_456.");

  const got = await vk("video.get", { videos: `${parsed.oid}_${parsed.id}` }, env);
  const video = got.items?.[0];
  if (!video) throw new Error("Video not found, or not accessible with this VK token.");

  const files = video.files || {};
  const media =
    files.mp4_240 || files.mp4_360 || files.mp4_480 || files.mp4_720 || files.mp4_1080 || files.external || null;

  return {
    media,
    embed: `https://vk.com/video_ext.php?oid=${parsed.oid}&id=${parsed.id}&hd=2`,
    title: video.title || null,
    duration: video.duration || 0,
    oid: parsed.oid,
    id: parsed.id,
  };
}

async function transcribeAudio(buffer, mime, env) {
  if (!env.SARVAM_API_KEY) throw new Error("No speech-to-text configured (SARVAM_API_KEY is missing).");
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

function wordsToCues(words, starts, ends, chunkDuration) {
  const cues = [];
  if (!Array.isArray(words) || !words.length) return cues;
  let buf = [], t0 = starts[0], t1 = starts[0];
  for (let i = 0; i < words.length; i++) {
    if (!buf.length) t0 = starts[i];
    buf.push(words[i]);
    t1 = ends[i];
    if (t1 - t0 > 7 || buf.length >= 9 || /[.!?।]$/.test(words[i])) {
      cues.push({ start: t0, end: t1 + 0.25, text: buf.join(" ") });
      buf = [];
    }
  }
  if (buf.length) cues.push({ start: t0, end: Math.max(t1, chunkDuration || t1), text: buf.join(" ") });
  return cues;
}

function spreadCues(text, duration) {
  const parts = String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const n = parts.length || 1;
  const step = (duration || n * 4) / n;
  return parts.map((p, i) => ({ start: i * step, end: (i + 1) * step, text: p }));
}

async function buildCues(media, mime, duration, env) {
  const res = await fetch(media, { headers: { "user-agent": "vk-video-live/1.0" } });
  if (!res.ok) throw new Error(`media fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const stt = await transcribeAudio(buffer, res.headers.get("content-type") || mime, env);

  const words = stt.timestamps?.words;
  const starts = stt.timestamps?.start_time_seconds;
  const ends = stt.timestamps?.end_time_seconds;

  return Array.isArray(words) && words.length
    ? wordsToCues(words, starts, ends, duration)
    : spreadCues(stt.transcript || "", duration);
}

/* ------------------------------------------------------------------ */
/* handlers                                                            */
/* ------------------------------------------------------------------ */

async function handleTranscript(url, env, ctx) {
  const raw = url.searchParams.get("url") || "";
  const lang = url.searchParams.get("lang") || "hi";
  const wantStream = url.searchParams.get("stream") === "1";

  const parsed = parseLink(raw);
  if (!parsed) return bad("url is required");
  if (parsed.kind === "unknown") {
    return bad("Unsupported link. Use a VK Video link (vkvideo.ru/video-…_…) or a direct video file (.mp4, .webm, .m4v).");
  }

  if (!wantStream) {
    try {
      const info = await resolveMedia(parsed, env);
      const rawCues = await buildCues(info.media, null, info.duration, env);
      const cues = await Promise.all(
        rawCues.map(async (c) => {
          let dst = c.text;
          try { dst = await translate(c.text, "en", lang, env); } catch (_) {}
          return { start: c.start, end: c.end, src: c.text, dst };
        })
      );
      return json({ engine: "asr", targetLang: lang, cues, title: info.title, duration: info.duration }, 200, {
        "cache-control": "public, max-age=3600",
      });
    } catch (e) {
      return json({ cues: [], error: e.message }, 502);
    }
  }

  // ---- server-sent events: emit each cue as soon as it is translated ----
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  ctx.waitUntil((async () => {
    try {
      const info = await resolveMedia(parsed, env);
      await send({
        type: "meta",
        title: info.title,
        duration: info.duration,
        media: info.media,
        embed: info.embed,
        oid: info.oid,
        id: info.id,
      });
      if (!info.media) {
        await send({ type: "error", message: "No downloadable audio for this video (live stream or geo-blocked)." });
        return;
      }

      const rawCues = await buildCues(info.media, null, info.duration, env);
      if (!rawCues.length) {
        await send({ type: "done", engine: "asr", count: 0 });
        return;
      }

      // translate in small ordered batches so cues arrive progressively
      for (let i = 0; i < rawCues.length; i += 4) {
        const batch = rawCues.slice(i, i + 4);
        const done = await Promise.all(
          batch.map(async (c) => {
            let dst = c.text;
            try { dst = await translate(c.text, "en", lang, env); } catch (_) {}
            return { start: c.start, end: c.end, src: c.text, dst };
          })
        );
        for (const c of done) await send({ type: "cue", ...c });
      }
      await send({ type: "done", engine: "asr", count: rawCues.length });
    } catch (e) {
      await send({ type: "error", message: e.message || String(e) });
    } finally {
      try { await writer.close(); } catch (_) {}
    }
  })());

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      ...CORS,
    },
  });
}

async function handleSearch(url, env) {
  const q = (url.searchParams.get("q") || "").trim();
  const lang = url.searchParams.get("lang") || "en";
  if (!q) return bad("q is required");

  let queryRu = q;
  try { queryRu = await translate(q, lang, "ru", env); } catch (e) { console.warn(e.message); }

  let resp;
  try {
    resp = await vk("video.search", { q: queryRu, count: "24", sort: "2", hd: "1" }, env);
  } catch (e) {
    return json({ error: e.message, queryRu, results: [] }, 502);
  }

  const items = (resp.items || []).filter((v) => v && v.id && v.owner_id != null);
  const results = await Promise.all(
    items.map(async (v) => {
      const original = v.title || "";
      let title = original;
      try { title = await translate(original, "ru", lang, env); } catch (_) {}
      return {
        id: String(v.id),
        oid: String(v.owner_id),
        title,
        titleOriginal: original,
        duration: v.duration || 0,
        thumb: v.image?.[v.image.length - 1]?.url || v.photo_320 || "",
        embed: `https://vk.com/video_ext.php?oid=${v.owner_id}&id=${v.id}&hd=2`,
      };
    })
  );
  return json({ query: q, queryRu, lang, results });
}

async function handleTranslate(request, env) {
  const body = await request.json().catch(() => ({}));
  const { text, from = "ru", to = "hi" } = body;
  if (!text) return bad("text is required");
  try {
    return json({ text: await translate(text, from, to, env), from, to });
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
            mt: !!env.MT_BASE,
            russianProvider: env.GOOGLE_TRANSLATE_KEY ? "google" : env.YANDEX_TRANSLATE_KEY ? "yandex" : "none",
          });
        case "/api/transcript":
          return await handleTranscript(url, env, ctx);
        case "/api/search":
          return await handleSearch(url, env);
        case "/api/translate":
          if (request.method !== "POST") return bad("POST required", 405);
          return await handleTranslate(request, env);
        case "/":
          return new Response("VK Video Live API. Try /api/health", {
            headers: { "content-type": "text/plain", ...CORS },
          });
        default:
          return bad("not found", 404);
      }
    } catch (e) {
      return json({ error: e.message || String(e) }, 500);
    }
  },
};

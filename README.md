# VK Video Live — paste a link, get captions in your language

Paste a **VK Video link** or a **direct video file**, pick a language, and the site plays
the video with **live captions**, a **timed transcript** and optional **spoken dubbing** in
English, Hindi, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi,
Odia, Assamese or Urdu.

Free, unlimited and open source: the dubbing runs on your own device, and the translation
can run on a model you host yourself.

Live demo (GitHub Pages): **https://swami-prathmesh.github.io/vk-video-live/**

---

## What happens when you paste a link

1. The link is parsed in the browser: `vkvideo.ru/video-123_456`, `vk.com/video-123_456`,
   `vk.com/video_ext.php?oid=…&id=…`, or any URL ending in `.mp4`, `.webm`, `.m4v`, `.m3u8`.
2. The worker resolves it to a playable stream, sends the Russian audio to speech-to-text,
   and gets word-level timings back.
3. Each line is translated into your language and **streamed to the page as it is ready**,
   so captions start appearing within a few seconds instead of after the whole video.
4. The page plays the video, highlights the line being spoken, and builds the transcript.
   Press **Dub audio** and the same lines are spoken aloud on your device.

```
browser  --(link + language)-->  worker
worker   --(audio -> text)---->  speech-to-text
worker   --(text -> your lang)-> translation model
worker   --(cues, one by one)--> browser  (server-sent events)
browser  --(speaks the dub)--->  your speakers
```

---

## Free and unlimited — how

**Dubbing.** The browser's own speech engine speaks each translated cue over the muted
video. No server, no key, no quota, works offline.

**Translation.** Self-host `server/` — Meta **NLLB-200** or AI4Bharat **IndicTrans2**, both
open weights, 14 languages including Russian. Your machine, unlimited characters. Point the
worker at it with `MT_BASE` and every translation is free.

**Speech-to-text.** Swap `transcribeAudio()` for a self-hosted faster-whisper service when
you want the last paid dependency gone; the function is the only place that touches STT.

**Hosting.** GitHub Pages for the site, Cloudflare Workers free tier for the API.

**Quality, honestly.** Browser voices are clear but robotic — a good GPS, not a voice actor.
NLLB is solid for Indian languages; IndicTrans2 is better on Hindi, Marathi and Bengali
nuance. For broadcast quality, swap the TTS for a neural voice service and keep everything
else identical.

---

## Quick start

Out of the box the site runs in **demo mode**: paste one of the sample clip links and the
full experience works — player, 14 languages, captions, transcript, downloads, dubbing —
using captions that ship with the site.

To go live, deploy `worker/` with wrangler, add the secrets `VK_ACCESS_TOKEN` and `MT_BASE`
(or `SARVAM_API_KEY`), then set `API_BASE` in `assets/js/config.js` to the worker URL and
push. `curl <worker-url>/api/health` reports which pieces are wired up.

To run the translator: install `server/requirements.txt`, start `server/app.py` with
uvicorn on port 8080, and set `MT_BASE` to that address.

---

## Project layout

```
index.html                  app shell: link bar, player, caption panel
assets/css/styles.css       dark UI, VK-blue accent
assets/js/config.js         ← the only file you edit to go live
assets/js/langs.js          14 caption languages
assets/js/i18n.js           UI strings: English, Hindi, Marathi, Russian
assets/js/demo.js           sample clip links for demo mode
assets/js/demo-captions.js  demo cues pre-translated into all 14 languages
assets/js/app.js            link parsing, player, live captions, transcript, dubbing
worker/src/index.js         Worker: /api/transcript (SSE), /api/search, /api/translate
server/app.py               self-hosted NLLB-200 translation (free, unlimited)
```

## API

```
GET  /api/transcript?url=<link>&lang=hi&stream=1     server-sent events: meta, cue, done
GET  /api/transcript?url=<link>&lang=hi              same as one JSON object
POST /api/translate   {"text":"Привет","from":"ru","to":"gu"}
GET  /api/health
```

## Known limits

- **Videos that only play in VK's iframe** cannot be time-synced: the embed does not expose
  playback position to the page. The transcript still arrives in order; captions and dubbing
  need a direct stream, which the worker returns whenever VK offers one.
- **Voices come from your device.** Android, Windows and macOS ship Indian-language voices;
  some Linux browsers ship English only. The panel says so and tells you where to add one.
- **A long cue can overrun the next one** — speech restarts at each cue boundary, which is
  how live dubbing behaves everywhere.
- **Worker memory.** The worker downloads the smallest rendition (`mp4_240`) to transcribe;
  very long videos may need chunked uploads.
- Respect VK's terms and the rights of the video owners. This uses the official API only.

## License

MIT — see `LICENSE`. The models keep their own licences.

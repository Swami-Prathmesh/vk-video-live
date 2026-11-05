# VK Video Live — search vkvideo.ru, watch with translated captions **and dubbing**

A single-page site that lets you **search VK Video (vkvideo.ru) in any Indian language**
and watch the result with captions **and spoken audio** translated into your language —
English, Hindi, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi,
Odia, Assamese, Urdu.

Free, unlimited and open source: the dubbing runs on your own device, and the translation
can run on a model you host yourself.

Live demo (GitHub Pages): **https://swami-prathmesh.github.io/vk-video-live/**

---

## What it does

1. You type a query in **your** language. The site sends it to a small backend.
2. The backend translates the query **into Russian**, calls `video.search` on the VK API,
   and translates the titles back into your language.
3. When you open a video it pulls the audio, runs speech-to-text on the Russian speech,
   and translates every cue into your chosen language, with timings attached.
4. The browser plays the video, highlights each cue as it plays, and — if you press
   **Dub audio** — speaks the translated line in your language while the original audio
   is muted. That is the Instagram-style dubbing, done on-device.

```
browser  --(query in your language)-->  worker
worker   --(query in Russian)-------->  VK video.search
worker   --(results + captions)------>  browser
browser  --(speaks the dub locally)-->  your ears
```

---

## Free and unlimited — how

| Layer | Free path | Paid alternative |
|---|---|---|
| **Dubbing (TTS)** | The browser's built-in speech engine (`speechSynthesis`). No server, no key, no quota, works offline. | Sarvam / ElevenLabs for studio-quality voices |
| **Translation (MT)** | Self-host `server/` — Meta **NLLB-200** or AI4Bharat **IndicTrans2**, both open weights. Your machine, unlimited characters. | Sarvam AI, Google, Yandex |
| **Speech-to-text** | Self-host faster-whisper (or Whisper large-v3) next to the MT server | Sarvam `speech-to-text-translate` |
| **Hosting** | GitHub Pages (static) + Cloudflare Workers free tier (100k req/day) | — |
| **VK search** | VK API with a free app token | — |

Nothing in the free path meters you. The only cost is the machine you run the models on:
the 600M NLLB model runs on a laptop CPU, faster-whisper `small` runs on CPU too.

**Quality, honestly:** browser voices are clear but robotic — think 2015 GPS, not a human
voice actor. NLLB is good for Indian languages, weaker than IndicTrans2 on Hindi/Marathi/
Bengali nuance. If you want broadcast quality, swap the TTS for Sarvam's `/text-to-speech`
and keep everything else identical.

---

## What works out of the box

| | Demo mode (default) | Live mode |
|---|---|---|
| Search UI, results grid, player | ✅ | ✅ |
| 14 caption languages, live switching | ✅ pre-translated sample | ✅ machine translated |
| Captions synced to playback | ✅ | ✅ when a direct file is returned |
| **Dub audio (spoken translation)** | ✅ | ✅ |
| Real vkvideo.ru results | — | needs `VK_ACCESS_TOKEN` |
| Real translation | — | needs `MT_BASE` or `SARVAM_API_KEY` |

---

## Project layout

```
index.html                  the whole app shell
assets/css/styles.css       styling (dark, VK-blue accent)
assets/js/config.js         ← the only file you edit to go live
assets/js/langs.js          14 caption languages + quick searches
assets/js/i18n.js           UI strings: English, Hindi, Marathi, Russian
assets/js/demo.js           demo catalogue used when API_BASE is empty
assets/js/demo-captions.js  demo cues pre-translated into all 14 languages
assets/js/app.js            search, player, caption sync, on-device dubbing
worker/src/index.js         Cloudflare Worker: /api/search, /api/captions, /api/translate
server/app.py               self-hosted NLLB-200 translation (free, unlimited)
```

## API

```
GET  /api/search?q=मॉस्को&lang=hi
GET  /api/captions?oid=-12345&id=456239017&lang=mr
POST /api/translate   {"text":"Привет","from":"ru","to":"gu"}
GET  /api/health
```

## Known limits

- **Dubbing needs the direct stream.** The `<video>` element is muted and the speech
  engine speaks each cue. Videos that only play inside the VK iframe cannot be dubbed,
  because the page cannot control that player — captions still work there.
- **Voices are whatever your device has.** Android, Windows and macOS ship Indian-language
  voices; some desktop Linux and browsers ship only English. The panel tells you when a
  voice is missing and where to install one.
- **A long cue can overrun the next one.** Speech is cancelled and restarted at each cue
  boundary, which is how live dubbing behaves; a time-stretched dub would need pre-rendered
  audio.
- **Transcription is per-video, not per-second.** The worker transcribes first, then returns
  timed cues; on a long video the first cues take a few seconds. True streaming ASR needs a
  WebSocket worker — the endpoint is isolated in `transcribeAudio()`.
- **Worker memory** — download the smallest rendition (`mp4_240`) for transcription; very
  long videos may need chunked uploads.
- Respect VK's terms and the rights of the video owners; this uses the official API only.

## License

MIT — see `LICENSE`. The models (NLLB-200, IndicTrans2, Whisper) keep their own licences.

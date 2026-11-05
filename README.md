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

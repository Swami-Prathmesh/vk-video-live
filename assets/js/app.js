/* app.js — paste a link → player → live captions + transcript in your language */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var cfg = window.CONFIG;
  var LANGS = window.LANGS;
  var BY = window.LANG_BY_CODE;

  var state = {
    uiLang: localStorage.getItem("vkvl.uiLang") || "en",
    capLang: localStorage.getItem("vkvl.capLang") || cfg.DEFAULT_CAPTION_LANG,
    video: null,          // { kind, oid, id, src, embed, title, duration }
    cues: [],
    activeIdx: -1,
    mode: cfg.API_BASE ? "live" : "demo",
    videoEl: null,
    stream: null,
    tab: "captions",
    busy: false
  };

  var dub = { on: false, voiceURI: null, speaking: false };

  /* ---------------- i18n ---------------- */
  function t(key) {
    var pack = window.I18N[state.uiLang] || window.I18N.en;
    return pack[key] || window.I18N.en[key] || key;
  }
  function applyI18n() {
    $$("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    $$("[data-i18n-placeholder]").forEach(function (el) { el.placeholder = t(el.getAttribute("data-i18n-placeholder")); });
    document.documentElement.lang = state.uiLang;
  }

  /* ---------------- utils ---------------- */
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function srtTime(sec) {
    sec = Math.max(0, sec || 0);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60), ms = Math.round((sec - Math.floor(sec)) * 1000);
    function p(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
    return p(h, 2) + ":" + p(m, 2) + ":" + p(s, 2) + "," + p(ms, 3);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  /* ---------------- link parsing ---------------- */
  function parseLink(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;

    // direct media file
    if (/\.(mp4|webm|m4v|mov|ogg|mp3|m4a|wav)(\?|#|$)/i.test(s)) {
      return { kind: "file", src: s };
    }

    // vk.com/video_ext.php?oid=-1&id=2
    var ext = s.match(/video_ext\.php\?.*?\boid=(-?\d+).*?\bid=(\d+)/i);
    if (ext) return { kind: "vk", oid: ext[1], id: ext[2] };

    // vk.com/video-123_456 , vkvideo.ru/video-123_456 , /clip-123_456
    var pair = s.match(/\/(?:video|clip)(-?\d+)_(\d+)/i);
    if (pair) return { kind: "vk", oid: pair[1], id: pair[2] };

    // vkvideo.ru/video123456?list=...  (owner unknown until resolved)
    var single = s.match(/\/video(\d{6,})/i);
    if (single) return { kind: "vk", oid: null, id: single[1] };

    return { kind: "unknown", src: s };
  }

  /* ---------------- flow ---------------- */
  function start(rawUrl) {
    var parsed = parseLink(rawUrl);
    var errBox = $("#homeError");
    errBox.hidden = true;

    if (!parsed) {
      showError("Paste a video link first.");
      return;
    }
    if (parsed.kind === "unknown") {
      showError("That link doesn't look like a VK Video link or a direct video file. Supported: vkvideo.ru/video-…_…, vk.com/video-…_…, and links ending in .mp4, .webm, .m4v or .m3u8.");
      return;
    }

    $("#url").value = rawUrl;
    $("#homeView").hidden = true;
    $("#watchView").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });

    state.video = parsed;
    state.cues = [];
    state.activeIdx = -1;
    $("#videoTitle").textContent = "Loading…";
    $("#videoChannel").textContent = "";
    $("#videoDuration").textContent = "";
    $("#videoSource").textContent = parsed.kind === "vk" ? "VK VIDEO" : "VIDEO FILE";
    $("#videoSource").className = "badge " + (state.mode === "live" ? "live" : "demo");
    $("#player").innerHTML = "";
    $("#playerNote").textContent = "";
    $("#cueList").innerHTML = "";
    $("#transcriptText").textContent = "";
    setTab("captions");
    setStatus("loading", "Reading the video…");

    if (parsed.kind === "file") {
      mountVideo({ src: parsed.src, title: fileTitle(parsed.src) });
      requestCaptions(parsed.src);
    } else if (state.mode === "live") {
      requestCaptions(parsed.src || rawUrl);
    } else {
      // demo mode cannot resolve VK ids — say so plainly
      mountIframe(parsed);
      setStatus("empty", "Demo mode — connect the worker to transcribe VK videos.");
      $("#playerNote").textContent =
        "This is a VK link, so it plays in VK's own embed. Captions need the worker: set API_BASE in assets/js/config.js and the audio is transcribed and translated automatically.";
    }
  }

  function showError(msg) {
    var box = $("#homeError");
    box.textContent = msg;
    box.hidden = false;
  }

  function fileTitle(url) {
    try {
      var last = new URL(url).pathname.split("/").pop() || "Video";
      return decodeURIComponent(last.replace(/\.[a-z0-9]+$/i, ""));
    } catch (e) {
      return "Video";
    }
  }

  /* ---------------- player ---------------- */
  function mountVideo(meta) {
    var box = $("#player");
    box.innerHTML = "";
    var v = document.createElement("video");
    v.controls = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.src = meta.src;
    v.addEventListener("timeupdate", syncCaptions);
    v.addEventListener("seeked", syncCaptions);
    v.addEventListener("pause", stopSpeech);
    v.addEventListener("playing", function () {
      if (dub.on) {
        var i = findCue(v.currentTime);
        if (i >= 0) speakCue(state.cues[i]);
      }
    });
    box.appendChild(v);
    state.videoEl = v;
    $("#dubBtn").disabled = false;
    v.muted = dub.on;

    if (meta.title) $("#videoTitle").textContent = meta.title;
    v.addEventListener("loadedmetadata", function () {
      if (!isNaN(v.duration)) $("#videoDuration").textContent = fmtTime(v.duration);
    });
    return v;
  }

  function mountIframe(v) {
    var box = $("#player");
    box.innerHTML = "";
    state.videoEl = null;
    var f = document.createElement("iframe");
    f.src = cfg.VK_EMBED.replace("{oid}", v.oid || "0").replace("{id}", v.id || "0");
    f.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    f.allowFullscreen = true;
    f.referrerPolicy = "origin";
    box.appendChild(f);
    $("#dubBtn").disabled = true;
    if (dub.on) setDub(false);
  }

  /* ---------------- captions ---------------- */
  function requestCaptions(url) {
    var lang = state.capLang;

    if (state.mode === "demo") {
      var sample = (window.SAMPLE_LINKS || []).filter(function (s) { return s.url === url; })[0];
      if (!sample) {
        setStatus("empty", "Demo mode — no transcription service connected.");
        $("#playerNote").textContent =
          "The file plays, but there is no speech-to-text without the worker. Set API_BASE in assets/js/config.js, or tap a sample clip below to see the full caption experience.";
        return;
      }
      state.video = { kind: "file", src: url, title: sample.title, duration: sample.duration };
      $("#videoTitle").textContent = sample.title;
      state.cues = buildDemoCues(sample, lang);
      renderCues();
      setStatus("ready", "Demo captions · pre-translated sample");
      $("#playerNote").textContent =
        "Demo mode: these captions ship with the site. Connect the worker and any link is transcribed and translated for real.";
      return;
    }

    var qs = "/api/transcript?url=" + encodeURIComponent(url) + "&lang=" + encodeURIComponent(lang) + "&stream=1";
    if (state.stream) { try { state.stream.abort(); } catch (e) {} }

    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    state.stream = ctrl;

    fetch(cfg.API_BASE + qs, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error("transcript request failed: " + res.status);
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buf = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += decoder.decode(r.value, { stream: true });
            var lines = buf.split("\n");
            buf = lines.pop();
            lines.forEach(function (line) {
              if (line.indexOf("data:") !== 0) return;
              var payload = line.slice(5).trim();
              if (!payload) return;
              var evt;
              try { evt = JSON.parse(payload); } catch (e) { return; }
              handleEvent(evt);
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        console.error(err);
        setStatus("error", "Caption service unreachable.");
      });
  }

  function handleEvent(evt) {
    if (evt.type === "meta") {
      if (evt.title) $("#videoTitle").textContent = evt.title;
      if (evt.duration) $("#videoDuration").textContent = fmtTime(evt.duration);
      if (evt.media) {
        mountVideo({ src: evt.media, title: evt.title });
      } else if (evt.embed) {
        mountIframe({ oid: evt.oid, id: evt.id });
        $("#playerNote").textContent =
          "This video plays in VK's own embed, which does not expose playback time — the transcript runs in order and captions cannot auto-highlight here.";
      }
      return;
    }
    if (evt.type === "cue") {
      state.cues.push({ start: evt.start, end: evt.end, src: evt.src, dst: evt.dst });
      appendCue(state.cues[state.cues.length - 1], state.cues.length - 1);
      setStatus("ready", "Transcribing live · " + state.cues.length + " lines");
      return;
    }
    if (evt.type === "done") {
      if (state.cues.length) {
        setStatus("ready", (evt.engine === "subtitles" ? "From the video's own subtitles" : "Auto-transcribed from the audio") +
          " · " + (state.capLang || "").toUpperCase());
      } else {
        setStatus("empty", "No speech detected in this video.");
      }
      renderTranscript();
      return;
    }
    if (evt.type === "error") {
      setStatus("error", evt.message || "Could not build captions for this link.");
    }
  }

  function buildDemoCues(sample, lang) {
    var src = (window.DEMO_CAPTIONS && window.DEMO_CAPTIONS.ru) || [];
    var dst = (window.DEMO_CAPTIONS && window.DEMO_CAPTIONS[lang]) || src;
    var n = src.length, dur = sample.duration || 15, step = dur / n, out = [];
    for (var i = 0; i < n; i++) {
      out.push({ start: i * step, end: (i + 1) * step, src: src[i], dst: dst[i] || src[i] });
    }
    return out;
  }

  function setStatus(kind, text) {
    var label = text || "";
    if (kind === "loading") label = "Transcribing and translating…";
    $("#capStatus").innerHTML =
      '<span class="dot ' + (kind === "ready" ? "on" : "") + '"></span><span>' + esc(label) + "</span>";
  }

  function cueNode(c, i) {
    var li = document.createElement("li");
    li.className = "cue";
    li.dataset.idx = String(i);
    li.innerHTML =
      '<span class="cue-time">' + fmtTime(c.start) + "</span>" +
      "<div>" +
        (c.src && c.src !== c.dst ? '<p class="cue-src" lang="ru">' + esc(c.src) + "</p>" : "") +
        '<p class="cue-dst" lang="' + esc(state.capLang) + '">' + esc(c.dst || c.src || "") + "</p>" +
      "</div>";
    li.addEventListener("click", function () {
      if (state.videoEl) state.videoEl.currentTime = c.start + 0.05;
    });
    return li;
  }

  function appendCue(c, i) {
    $("#cueList").appendChild(cueNode(c, i));
  }

  function renderCues() {
    var list = $("#cueList");
    list.innerHTML = "";
    if (!state.cues.length) {
      list.innerHTML = '<div class="cap-empty">Captions will appear here as the audio is transcribed.</div>';
      return;
    }
    state.cues.forEach(function (c, i) { list.appendChild(cueNode(c, i)); });
    renderTranscript();
  }

  function renderTranscript() {
    var text = state.cues.map(function (c) { return c.dst || c.src || ""; }).join(" ").trim();
    $("#transcriptText").textContent = text || "No transcript yet.";
  }

  function syncCaptions() {
    var v = state.videoEl;
    if (!v || !state.cues.length) return;
    var now = v.currentTime;
    var idx = -1;
    for (var i = 0; i < state.cues.length; i++) {
      if (now >= state.cues[i].start && now < state.cues[i].end) { idx = i; break; }
    }
    if (idx === state.activeIdx) return;
    state.activeIdx = idx;
    var list = $("#cueList");
    var prev = list.querySelector(".cue.active");
    if (prev) prev.classList.remove("active");
    if (idx >= 0) {
      var el = list.querySelector('.cue[data-idx="' + idx + '"]');
      if (el) {
        el.classList.add("active");
        var top = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2;
        list.scrollTo({ top: top, behavior: "smooth" });
      }
    }
    if (dub.on && idx >= 0) speakCue(state.cues[idx]);
  }

  function findCue(t) {
    for (var i = 0; i < state.cues.length; i++) {
      if (t >= state.cues[i].start && t < state.cues[i].end) return i;
    }
    return -1;
  }

  /* ---------------- dubbing ---------------- */
  function synthAvailable() {
    return typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";
  }
  function voicesFor(code) {
    if (!synthAvailable()) return [];
    var want = ((BY[code] || {}).bcp) || code;
    var prefix = want.split("-")[0].toLowerCase();
    var all = window.speechSynthesis.getVoices() || [];
    var exact = all.filter(function (v) { return (v.lang || "").toLowerCase() === want.toLowerCase(); });
    if (exact.length) return exact;
    return all.filter(function (v) { return (v.lang || "").toLowerCase().indexOf(prefix) === 0; });
  }
  function showDubNote(msg) { var el = $("#dubNote"); el.textContent = msg; el.hidden = false; }
  function hideDubNote() { $("#dubNote").hidden = true; }

  function refreshVoices() {
    var sel = $("#voiceSelect");
    var list = voicesFor(state.capLang);
    sel.innerHTML = "";
    if (!list.length) {
      var o = document.createElement("option");
      o.textContent = "No voice installed";
      sel.appendChild(o);
      sel.disabled = true;
      var nm = (BY[state.capLang] || {}).name || state.capLang;
      showDubNote("No " + nm + " voice is installed on this device. Captions still work; add a system voice (Android: Settings → Text-to-speech; Windows: Settings → Speech; macOS: System Settings → Accessibility → Spoken Content) to hear the dub.");
      return;
    }
    sel.disabled = false;
    hideDubNote();
    list.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v.voiceURI;
      o.textContent = v.name + (v.localService ? "" : " · cloud");
      if (dub.voiceURI === v.voiceURI) o.selected = true;
      sel.appendChild(o);
    });
    if (!dub.voiceURI || !list.some(function (v) { return v.voiceURI === dub.voiceURI; })) {
      dub.voiceURI = list[0].voiceURI;
      sel.value = dub.voiceURI;
    }
  }

  function speakCue(cue) {
    if (!dub.on || !synthAvailable() || !cue) return;
    var text = cue.dst || cue.src;
    if (!text) return;
    var list = voicesFor(state.capLang);
    if (!list.length) return;
    var voice = list.filter(function (v) { return v.voiceURI === dub.voiceURI; })[0] || list[0];
    try { window.speechSynthesis.cancel(); } catch (e) {}
    var u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang || ((BY[state.capLang] || {}).bcp) || state.capLang;
    u.rate = 1;
    u.pitch = 1;
    u.onstart = function () { dub.speaking = true; };
    u.onend = function () { dub.speaking = false; };
    u.onerror = function () { dub.speaking = false; };
    window.speechSynthesis.speak(u);
  }
  function stopSpeech() {
    if (synthAvailable()) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    dub.speaking = false;
  }
  function setDub(on) {
    if (on && !state.videoEl) {
      showDubNote("Dubbing needs direct access to the video stream. This one plays in VK's embed, which the page cannot control — captions still work.");
      return;
    }
    dub.on = !!on;
    $("#dubBtn").setAttribute("aria-pressed", on ? "true" : "false");
    $("#dubLabel").textContent = on ? t("dubOff") : t("dubOn");
    if (state.videoEl) state.videoEl.muted = !!on;
    if (!on) { stopSpeech(); hideDubNote(); return; }
    refreshVoices();
    if (state.videoEl) {
      var i = findCue(state.videoEl.currentTime);
      if (i >= 0) speakCue(state.cues[i]);
    }
  }

  /* ---------------- tabs & downloads ---------------- */
  function setTab(name) {
    state.tab = name;
    $$(".tab").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
    $("#cueList").hidden = name !== "captions";
    $("#transcriptPane").hidden = name !== "transcript";
  }

  function download(name, content, mime) {
    var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function baseName() {
    var title = ($("#videoTitle").textContent || "transcript").trim();
    return title.replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, "_").slice(0, 60) || "transcript";
  }

  /* ---------------- boot ---------------- */
  function boot() {
    applyI18n();

    var uiSel = $("#uiLangSelect");
    [["en", "English"], ["hi", "हिंदी"], ["mr", "मराठी"], ["ru", "Русский"]].forEach(function (p) {
      var o = document.createElement("option");
      o.value = p[0]; o.textContent = p[1];
      if (p[0] === state.uiLang) o.selected = true;
      uiSel.appendChild(o);
    });
    uiSel.addEventListener("change", function () {
      state.uiLang = uiSel.value;
      localStorage.setItem("vkvl.uiLang", state.uiLang);
      applyI18n();
    });

    LANGS.forEach(function (l) {
      [$("#heroLang"), $("#langSelect")].forEach(function (sel) {
        var o = document.createElement("option");
        o.value = l.code;
        o.textContent = l.native;
        if (l.code === state.capLang) o.selected = true;
        sel.appendChild(o);
      });
    });
    $("#heroLang").addEventListener("change", function () {
      state.capLang = $("#heroLang").value;
      $("#langSelect").value = state.capLang;
      localStorage.setItem("vkvl.capLang", state.capLang);
    });
    $("#langSelect").addEventListener("change", function () {
      state.capLang = $("#langSelect").value;
      $("#heroLang").value = state.capLang;
      localStorage.setItem("vkvl.capLang", state.capLang);
      stopSpeech();
      dub.voiceURI = null;
      refreshVoices();
      if (state.video) {
        state.cues = [];
        $("#cueList").innerHTML = "";
        setStatus("loading", "Translating into the new language…");
        requestCaptions(state.video.src || $("#url").value);
      }
    });

    $("#dubBtn").addEventListener("click", function () { setDub(!dub.on); });
    $("#voiceSelect").addEventListener("change", function () {
      dub.voiceURI = $("#voiceSelect").value;
      stopSpeech();
    });
    if (synthAvailable()) {
      refreshVoices();
      window.speechSynthesis.onvoiceschanged = function () { refreshVoices(); };
    } else {
      $("#dubBtn").disabled = true;
      showDubNote("This browser has no speech engine, so dubbing is unavailable. Captions still work.");
    }

    $$(".tab").forEach(function (b) {
      b.addEventListener("click", function () { setTab(b.dataset.tab); });
    });

    $("#dlTxt").addEventListener("click", function () {
      var lines = state.cues.map(function (c) { return "[" + fmtTime(c.start) + "] " + (c.dst || c.src); });
      download(baseName() + ".txt", lines.join("\n") + "\n");
    });
    $("#dlSrt").addEventListener("click", function () {
      var srt = state.cues.map(function (c, i) {
        return (i + 1) + "\n" + srtTime(c.start) + " --> " + srtTime(c.end) + "\n" + (c.dst || c.src) + "\n";
      }).join("\n");
      download(baseName() + ".srt", srt, "application/x-subrip;charset=utf-8");
    });

    $("#linkForm").addEventListener("submit", function (e) {
      e.preventDefault();
      start($("#url").value);
    });

    var chips = $("#sampleChips");
    (window.SAMPLE_LINKS || []).forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = s.label;
      b.addEventListener("click", function () {
        $("#url").value = s.url;
        start(s.url);
      });
      chips.appendChild(b);
    });

    $("#brandLink").addEventListener("click", function (e) {
      e.preventDefault();
      $("#watchView").hidden = true;
      $("#homeView").hidden = false;
      stopSpeech();
      if (state.videoEl) { try { state.videoEl.pause(); } catch (er) {} }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $("#backBtn").addEventListener("click", function () {
      $("#watchView").hidden = true;
      $("#homeView").hidden = false;
      stopSpeech();
      if (state.stream) { try { state.stream.abort(); } catch (e) {} }
      if (state.videoEl) { try { state.videoEl.pause(); } catch (e) {} }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    var pill = $("#modePill");
    pill.textContent = state.mode === "live" ? "LIVE" : "DEMO";
    pill.className = "pill " + (state.mode === "live" ? "live" : "");
    [$("#repoLink"), $("#repoLink2")].forEach(function (a) { if (cfg.REPO_URL) a.href = cfg.REPO_URL; });

    setTab("captions");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

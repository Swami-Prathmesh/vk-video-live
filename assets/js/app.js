/* app.js — search → results → player → translated captions */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var cfg = window.CONFIG;
  var LANGS = window.LANGS;
  var BY = window.LANG_BY_CODE;

  var state = {
    uiLang: localStorage.getItem("vkvl.uiLang") || "en",
    capLang: localStorage.getItem("vkvl.capLang") || cfg.DEFAULT_CAPTION_LANG,
    results: [],
    current: null,
    cues: [],
    activeIdx: -1,
    mode: cfg.API_BASE ? "live" : "demo",
    videoEl: null,
    busy: false
  };

  var dub = { on: false, voiceURI: null, speaking: false };

  /* ---------------- i18n ---------------- */
  function t(key) {
    var pack = window.I18N[state.uiLang] || window.I18N.en;
    return pack[key] || window.I18N.en[key] || key;
  }
  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
    });
    document.documentElement.lang = state.uiLang;
  }

  /* ---------------- selects ---------------- */
  function fillSelect(sel, current) {
    sel.innerHTML = "";
    LANGS.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.code;
      o.textContent = l.native + (l.code === "ru" ? "" : "");
      if (l.code === current) o.selected = true;
      sel.appendChild(o);
    });
  }

  /* ---------------- utils ---------------- */
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function monogram(title) {
    var letters = (title || "VK").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0); }).join("");
    return letters.toUpperCase() || "VK";
  }

  /* ---------------- demo search ---------------- */
  function demoSearch(q) {
    var needle = (q || "").trim().toLowerCase();
    var all = window.DEMO_CATALOGUE;
    if (!needle) return all.slice();
    return all.filter(function (v) {
      var hay = [v.title, v.titleEn, v.channel].concat(v.tags).join(" ").toLowerCase();
      return hay.indexOf(needle) !== -1;
    });
  }

  /* ---------------- search ---------------- */
  function doSearch(q) {
    q = (q || "").trim();
    if (!q) return;
    $("#q").value = q;
    setBusy(true);
    $("#emptyState").hidden = true;

    if (!cfg.API_BASE) {
      // demo mode: local filter, tiny delay so the state is visible
      setTimeout(function () {
        var res = demoSearch(q);
        state.mode = "demo";
        state.results = res;
        renderResults(q);
        setBusy(false);
      }, 220);
      return;
    }

    var url = cfg.API_BASE + "/api/search?q=" + encodeURIComponent(q) + "&lang=" + state.capLang;
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("search failed: " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.mode = "live";
        state.results = (data.results || []).map(function (v) {
          return {
            id: String(v.id),
            oid: v.oid != null ? String(v.oid) : null,
            title: v.title || v.titleOriginal || "Video",
            titleOriginal: v.titleOriginal || v.title || "",
            channel: v.channel || "VK Video",
            duration: v.duration || 0,
            thumb: v.thumb || "",
            mp4: v.mp4 || "",
            embed: v.embed || "",
            lang: "ru"
          };
        });
        renderResults(q);
        setBusy(false);
      })
      .catch(function (err) {
        console.error(err);
        state.mode = "demo";
        state.results = demoSearch(q);
        renderResults(q, "Live search is not reachable — showing the demo catalogue.");
        setBusy(false);
      });
  }

  function setBusy(on) {
    state.busy = on;
    var btn = $("#searchBtn");
    btn.disabled = on;
    btn.textContent = on ? t("searching") : t("searchBtn");
    if (on) btn.textContent = "…";
  }

  /* ---------------- results ---------------- */
  function renderResults(q, note) {
    var grid = $("#grid");
    grid.innerHTML = "";
    var items = state.results;
    $("#resultsTitle").textContent = q ? "“" + q + "”" : t("resultsTitle");
    $("#resultsCount").textContent = items.length + (state.mode === "demo" ? " · " + t("demoNote") : "");
    $("#emptyState").hidden = items.length > 0;

    items.forEach(function (v) {
      var card = document.createElement("article");
      card.className = "card";
      card.tabIndex = 0;
      var thumbInner = v.thumb
        ? '<img src="' + esc(v.thumb) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
        : '<span class="mono">' + esc(monogram(v.title)) + "</span>";
      card.innerHTML =
        '<div class="thumb">' + thumbInner +
          '<span class="dur">' + fmtTime(v.duration) + "</span>" +
          '<span class="play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></span>' +
        "</div>" +
        '<div class="card-body">' +
          '<div class="card-title">' + esc(v.title) + "</div>" +
          '<div class="card-sub"><span class="tag ru">RU</span><span>' + esc(v.channel) + "</span></div>" +
        "</div>";
      card.addEventListener("click", function () { openWatch(v); });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openWatch(v); }
      });
      grid.appendChild(card);
    });
  }

  /* ---------------- watch view ---------------- */
  function openWatch(item) {
    state.current = item;
    state.activeIdx = -1;
    $("#searchView").hidden = true;
    $("#watchView").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });

    $("#videoTitle").textContent = item.title;
    $("#videoChannel").textContent = item.channel;
    $("#videoDuration").textContent = item.duration ? fmtTime(item.duration) : "";
    var srcBadge = $("#videoSource");
    srcBadge.textContent = state.mode === "live" ? "VK VIDEO" : "DEMO CLIP";
    srcBadge.className = "badge " + (state.mode === "live" ? "live" : "demo");

    mountPlayer(item);
    loadCues(item);
  }

  function mountPlayer(item) {
    var box = $("#player");
    box.innerHTML = "";
    state.videoEl = null;
    $("#playerNote").textContent = "";

    if (item.mp4) {
      var v = document.createElement("video");
      v.controls = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.src = item.mp4;
      if (item.poster) v.poster = item.poster;
      v.addEventListener("timeupdate", syncCaptions);
      v.addEventListener("seeked", syncCaptions);
      box.appendChild(v);
      state.videoEl = v;
      v.muted = dub.on;
      v.addEventListener("pause", stopSpeech);
      v.addEventListener("playing", function () {
        if (dub.on) {
          var i = findCue(v.currentTime);
          if (i >= 0) speakCue(state.cues[i]);
        }
      });
      $("#dubBtn").disabled = false;
      if (state.mode === "demo") {
        $("#playerNote").textContent =
          "Demo clip. In live mode this is the VK video itself, played from the stream the API returns.";
      }
      return;
    }

    var oid = item.oid, vid = item.id;
    if (oid && vid) {
      var f = document.createElement("iframe");
      f.src = item.embed || cfg.VK_EMBED.replace("{oid}", oid).replace("{id}", vid);
      f.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
      f.allowFullscreen = true;
      f.referrerPolicy = "origin";
      box.appendChild(f);
      $("#dubBtn").disabled = true;
      if (dub.on) setDub(false);
      $("#playerNote").textContent =
        "This video is playing from the VK embed. Embedded players do not expose playback time to the page, so captions are listed in order without auto-highlighting — open the video on vkvideo.ru for frame-accurate sync.";
    }
  }

  /* ---------------- captions ---------------- */
  function buildDemoCues(item, lang) {
    var src = (window.DEMO_CAPTIONS && window.DEMO_CAPTIONS.ru) || [];
    var dst = (window.DEMO_CAPTIONS && window.DEMO_CAPTIONS[lang]) || src;
    var n = src.length;
    var dur = item.duration || 15;
    var step = dur / n;
    var cues = [];
    for (var i = 0; i < n; i++) {
      cues.push({ start: i * step, end: (i + 1) * step, src: src[i], dst: dst[i] || src[i] });
    }
    return cues;
  }

  function loadCues(item) {
    var lang = state.capLang;
    var list = $("#cueList");
    list.innerHTML = "";
    $("#capFoot").innerHTML = "";
    setCapStatus("loading");

    if (state.mode === "demo") {
      state.cues = buildDemoCues(item, lang);
      renderCues();
      setCapStatus("ready", "Demo captions · pre-translated sample");
      $("#capFoot").innerHTML =
        "Demo captions are bundled with the site so the panel works offline. In live mode the worker transcribes the Russian audio and translates it in real time.";
      return;
    }

    var url = cfg.API_BASE + "/api/captions?oid=" + encodeURIComponent(item.oid || "") +
      "&id=" + encodeURIComponent(item.id) + "&lang=" + encodeURIComponent(lang);
    fetch(url)
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.cues || !res.j.cues.length) {
          state.cues = [];
          renderCues();
          setCapStatus("empty", res.j.error || "No captions available for this video yet.");
          $("#capFoot").innerHTML =
            "Try another video, or check the worker logs — the translation pipeline needs VK + Sarvam keys.";
          return;
        }
        state.cues = res.j.cues;
        renderCues();
        setCapStatus("ready", (res.j.engine === "subtitles" ? "From the video's own subtitles" : "Auto-transcribed from the Russian audio") +
          " · " + (res.j.targetLang || lang).toUpperCase());
      })
      .catch(function (err) {
        console.error(err);
        setCapStatus("error", "Caption service unreachable.");
      });
  }

  function setCapStatus(kind, text) {
    var el = $("#capStatus");
    var label = text || "";
    if (kind === "loading") label = "Transcribing and translating…";
    if (kind === "ready") label = label || "Ready";
    if (kind === "empty") label = label || "No captions";
    if (kind === "error") label = label || "Error";
    el.innerHTML = '<span class="dot ' + (kind === "ready" ? "on" : "") + '"></span><span>' + esc(label) + "</span>";
  }

  function renderCues() {
    var list = $("#cueList");
    list.innerHTML = "";
    if (!state.cues.length) {
      list.innerHTML = '<div class="cap-empty">No captions for this video yet.</div>';
      return;
    }
    state.cues.forEach(function (c, i) {
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
      list.appendChild(li);
    });
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

  /* ---------------- dubbing: free, unlimited, on-device TTS ----------------
     The translated cue text is spoken by the browser's own speech engine and
     played over the muted video. No server, no API key, no per-minute cost. */

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

  function showDubNote(msg) {
    var el = $("#dubNote");
    el.textContent = msg;
    el.hidden = false;
  }
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
      showDubNote("No " + nm + " voice is installed on this device. Captions still work; add a system voice (Android: Settings → Text-to-speech; Windows: Settings → Time & language → Speech; macOS: System Settings → Accessibility → Spoken Content) to hear the dub.");
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

  function findCue(t) {
    for (var i = 0; i < state.cues.length; i++) {
      if (t >= state.cues[i].start && t < state.cues[i].end) return i;
    }
    return -1;
  }

  function speakCue(cue) {
    if (!dub.on || !synthAvailable() || !cue) return;
    var text = cue.dst || cue.src;
    if (!text) return;
    var list = voicesFor(state.capLang);
    if (!list.length) return;
    var voice = list.filter(function (v) { return v.voiceURI === dub.voiceURI; })[0] || list[0];
    try { window.speechSynthesis.cancel(); } catch (_) {}
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
    if (synthAvailable()) { try { window.speechSynthesis.cancel(); } catch (_) {} }
    dub.speaking = false;
  }

  function setDub(on) {
    if (on && !state.videoEl) {
      showDubNote("Dubbing needs direct access to the video stream. This one plays from the VK embed, which the page cannot control — captions still work.");
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
      renderResults($("#q").value.trim());
      if (state.current) loadCues(state.current);
    });

    fillSelect($("#langSelect"), state.capLang);
    $("#langSelect").addEventListener("change", function () {
      state.capLang = $("#langSelect").value;
      localStorage.setItem("vkvl.capLang", state.capLang);
      stopSpeech();
      dub.voiceURI = null;
      refreshVoices();
      if (state.current) loadCues(state.current);
    });

    // dubbing controls
    $("#dubBtn").addEventListener("click", function () {
      setDub(!dub.on);
    });
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

    var pill = $("#modePill");
    pill.textContent = state.mode === "live" ? "LIVE" : "DEMO";
    pill.className = "pill " + (state.mode === "live" ? "live" : "");

    [$("#repoLink"), $("#repoLink2")].forEach(function (a) {
      if (cfg.REPO_URL) a.href = cfg.REPO_URL;
    });

    // quick search chips
    var chips = $("#quickChips");
    (window.QUICK_SEARCHES || []).forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = s.label;
      b.addEventListener("click", function () { doSearch(s.q); });
      chips.appendChild(b);
    });

    $("#searchForm").addEventListener("submit", function (e) {
      e.preventDefault();
      doSearch($("#q").value);
    });
    $("#brandLink").addEventListener("click", function (e) {
      e.preventDefault();
      $("#watchView").hidden = true;
      $("#searchView").hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $("#backBtn").addEventListener("click", function () {
      $("#watchView").hidden = true;
      $("#searchView").hidden = false;
      stopSpeech();
      if (state.videoEl) { try { state.videoEl.pause(); } catch (_) {} }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        $("#q").focus();
      }
    });

    state.results = window.DEMO_CATALOGUE.slice();
    renderResults("");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

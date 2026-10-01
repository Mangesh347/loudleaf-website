// Loudleaf site: the page reads itself with the visitor's own browser voice (Web Speech API, free),
// highlighting sentence + word exactly like the extension. Plus the speed lab, install links, prices.
(function () {
  "use strict";

  // After the first Chrome Web Store upload, paste the item URL here.
  var STORE_URL = "https://chromewebstore.google.com/search/Loudleaf%20read%20aloud";

  var $ = function (id) {
    return document.getElementById(id);
  };
  var T = window.LoudleafText;
  var synth = window.speechSynthesis;
  var hasHL = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";

  document.querySelectorAll("[data-install]").forEach(function (a) {
    a.href = STORE_URL;
    a.rel = "noopener";
  });
  if ($("year")) $("year").textContent = new Date().getFullYear();

  // ---------- Build the reading queue from [data-say] elements ----------
  function flatten(el) {
    var parts = [];
    var text = "";
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = w.nextNode())) {
      parts.push({ node: n, at: text.length, len: n.data.length });
      text += n.data;
    }
    return { el: el, text: text, parts: parts };
  }
  function range(block, s, e) {
    var r = document.createRange();
    var set = false;
    for (var i = 0; i < block.parts.length; i++) {
      var p = block.parts[i];
      if (!set && s < p.at + p.len) {
        r.setStart(p.node, s - p.at);
        set = true;
      }
      if (set && e <= p.at + p.len) {
        r.setEnd(p.node, e - p.at);
        return r;
      }
    }
    return r;
  }
  var queue = [];
  document.querySelectorAll("[data-say]").forEach(function (el) {
    var b = flatten(el);
    T.sentences(b.text).forEach(function (s) {
      queue.push({ block: b, start: s.start, end: s.end, text: b.text.slice(s.start, s.end), title: el.getAttribute("data-title") || "", track: el.closest("[data-track]") });
    });
  });

  // Track durations at 1× (180 wpm)
  document.querySelectorAll("[data-track]").forEach(function (tr) {
    var words = 0;
    queue.forEach(function (q) {
      if (q.track === tr) words += T.words(q.text);
    });
    var secs = Math.round((words / 180) * 60);
    tr.querySelector(".dur").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
  });

  // ---------- Player ----------
  var idx = 0;
  var playing = false;
  var rate = 1;
  var token = 0;
  var voice = null;
  var PLAY = '<path fill="currentColor" d="M8 5v14l11-7z"/>';
  var PAUSE = '<path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/>';
  var SPEEDS = [1, 1.25, 1.5, 2];

  function pickVoice() {
    if (!synth) return null;
    var vs = synth.getVoices().filter(function (v) {
      return /^en(-|_|$)/i.test(v.lang);
    });
    // Prefer natural online voices, then the system default.
    return (
      vs.find(function (v) {
        return /natural|neural|google/i.test(v.name);
      }) ||
      vs.find(function (v) {
        return v.default;
      }) ||
      vs[0] ||
      null
    );
  }
  if (synth) {
    voice = pickVoice();
    synth.onvoiceschanged = function () {
      voice = pickVoice();
    };
  } else document.body.classList.add("no-voice");

  function paint(i, ws, we) {
    if (!hasHL) return;
    var q = queue[i];
    CSS.highlights.set("ll-site-sentence", new Highlight(range(q.block, q.start, q.end)));
    if (ws != null) CSS.highlights.set("ll-site-word", new Highlight(range(q.block, q.start + ws, q.start + we)));
    else CSS.highlights.delete("ll-site-word");
  }
  function clearPaint() {
    if (!hasHL) return;
    CSS.highlights.delete("ll-site-sentence");
    CSS.highlights.delete("ll-site-word");
  }
  function ui() {
    $("dock").classList.toggle("on", playing);
    $("dock-ic").innerHTML = playing ? PAUSE : PLAY;
    $("dock-play").setAttribute("aria-label", playing ? "Pause" : "Play");
    $("hear-ic").innerHTML = playing ? PAUSE : PLAY;
    $("hear-label").textContent = playing ? "Pause" : idx > 0 ? "Keep listening" : "Read this page to me";
    var q = queue[idx] || queue[0];
    $("dock-title").textContent = q.title;
    $("dock-sub").textContent = playing ? "Reading · " + rate + "×" : idx > 0 ? "Paused" : "Press play to hear this page";
    $("dock-speed").textContent = rate + "×";
    $("dock-progress").style.width = (queue.length ? (idx / queue.length) * 100 : 0) + "%";
    document.querySelectorAll("[data-track]").forEach(function (tr) {
      tr.classList.toggle("is-on", playing && q.track === tr);
    });
  }
  function follow(i) {
    var r = range(queue[i].block, queue[i].start, queue[i].end).getBoundingClientRect();
    if (r.top < 90 || r.bottom > innerHeight - 140) scrollTo({ top: scrollY + r.top - innerHeight * 0.35, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function speak(i) {
    if (!synth) {
      $("dock-sub").textContent = "Your browser has no speech voices. Install Loudleaf in Chrome to listen.";
      return;
    }
    if (i >= queue.length) {
      stop();
      idx = 0;
      $("dock-sub").textContent = "That's the whole page. Imagine this on every article.";
      return;
    }
    var my = ++token;
    synth.cancel();
    idx = i;
    playing = true;
    var q = queue[i];
    var u = new SpeechSynthesisUtterance(q.text);
    u.rate = rate;
    if (voice) u.voice = voice;
    u.onstart = function () {
      if (my !== token) return;
      paint(i);
      follow(i);
      ui();
    };
    u.onboundary = function (e) {
      if (my !== token || e.name !== "word") return;
      var w = T.wordAt(q.text, e.charIndex);
      if (w) paint(i, w.start, w.end);
    };
    u.onend = function () {
      if (my === token && playing) speak(i + 1);
    };
    u.onerror = function (e) {
      if (my !== token || e.error === "interrupted" || e.error === "canceled") return;
      speak(i + 1);
    };
    synth.speak(u);
    ui();
  }
  function stop() {
    token++;
    playing = false;
    if (synth) synth.cancel();
    clearPaint();
    ui();
  }
  function toggle() {
    if (playing) {
      token++;
      playing = false;
      synth.cancel();
      ui();
    } else speak(idx);
  }
  $("hear").addEventListener("click", toggle);
  $("dock-play").addEventListener("click", toggle);
  $("dock-speed").addEventListener("click", function () {
    rate = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
    if (playing) speak(idx);
    else ui();
  });
  document.querySelectorAll("[data-track]").forEach(function (tr) {
    tr.querySelector(".track-play").addEventListener("click", function () {
      var first = queue.findIndex(function (q) {
        return q.track === tr;
      });
      if (playing && queue[idx].track === tr) toggle();
      else speak(first);
    });
  });
  // Show what's in view while paused, so the dock always invites the next listen.
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        if (playing) return;
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var i = queue.findIndex(function (q) {
            return q.track === en.target;
          });
          if (i >= 0) {
            idx = i;
            ui();
            $("dock-sub").textContent = "Press play to hear this part";
          }
        });
      },
      { rootMargin: "-40% 0px -50% 0px" }
    );
    document.querySelectorAll("[data-track]").forEach(function (tr) {
      io.observe(tr);
    });
  }
  addEventListener("keydown", function (e) {
    if (e.key === "Escape" && playing) stop();
  });
  addEventListener("pagehide", function () {
    if (synth) synth.cancel();
  });
  ui();

  // ---------- Speed lab ----------
  var labBlock = flatten($("lab-text"));
  var labParts = T.sentences(labBlock.text);
  var labToken = 0;
  function labUI() {
    var r = Number($("lab-rate").value);
    $("lab-x").textContent = r + "×";
    $("lab-wpm").textContent = "≈ " + Math.round(180 * r) + " words a minute";
  }
  $("lab-rate").addEventListener("input", labUI);
  labUI();
  $("lab-play").addEventListener("click", function () {
    if (!synth) return;
    stop();
    var my = ++labToken;
    var r = Number($("lab-rate").value);
    var k = 0;
    $("lab-play").textContent = "Playing…";
    (function next() {
      if (my !== labToken) return;
      if (k >= labParts.length) {
        $("lab-play").textContent = "Play at this speed";
        if (hasHL) CSS.highlights.delete("ll-site-word"), CSS.highlights.delete("ll-site-sentence");
        return;
      }
      var p = labParts[k];
      var txt = labBlock.text.slice(p.start, p.end);
      var u = new SpeechSynthesisUtterance(txt);
      u.rate = r;
      if (voice) u.voice = voice;
      if (hasHL) CSS.highlights.set("ll-site-sentence", new Highlight(range(labBlock, p.start, p.end)));
      u.onboundary = function (e) {
        if (my !== labToken || e.name !== "word" || !hasHL) return;
        var w = T.wordAt(txt, e.charIndex);
        if (w) CSS.highlights.set("ll-site-word", new Highlight(range(labBlock, p.start + w.start, p.start + w.end)));
      };
      u.onend = function () {
        k++;
        next();
      };
      synth.speak(u);
    })();
  });

  // ---------- Local prices ----------
  if (document.querySelector("[data-price]")) {
    fetch("/api/checkout/quote")
      .then(function (r) {
        return r.json();
      })
      .then(function (q) {
        if (!q || !q.ok) return;
        document.querySelectorAll("[data-price]").forEach(function (el) {
          var t = q.quotes[el.dataset.price];
          if (!t) return;
          var v = t.subtotalMinor / 100;
          try {
            el.textContent = new Intl.NumberFormat(t.currency === "INR" ? "en-IN" : undefined, { style: "currency", currency: t.currency, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v);
          } catch (_) {}
        });
        var save = Math.round((1 - q.quotes.yearly.subtotalMinor / (q.quotes.monthly.subtotalMinor * 12)) * 100);
        if ($("save-flag") && save > 0) $("save-flag").textContent = "Save " + save + "%";
      })
      .catch(function () {});
  }
})();

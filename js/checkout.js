// Loudleaf checkout: Google sign-in → pick term/currency → PayPal (first) or card via Razorpay →
// the server verifies the payment with the provider and updates the plan in Supabase → the
// extension re-checks its plan.
// This page never decides the price or the plan; it only shows what the API says.
(function () {
  "use strict";

  // Chrome Web Store item ID, once published (the ?ext= from the extension wins either way).
  const STORE_EXTENSION_ID = "";
  const TERMS = ["monthly", "yearly", "lifetime"];
  const PER = { monthly: "per month", yearly: "per year", lifetime: "one time" };
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  const extId = (() => {
    const fromUrl = params.get("ext");
    const valid = (v) => /^[a-p]{32}$/.test(v || "");
    try {
      if (valid(fromUrl)) sessionStorage.setItem("loudleaf_ext", fromUrl);
      const saved = sessionStorage.getItem("loudleaf_ext");
      if (valid(saved)) return saved;
    } catch (_) {}
    return valid(fromUrl) ? fromUrl : STORE_EXTENSION_ID;
  })();

  const state = {
    term: TERMS.includes(params.get("term")) ? params.get("term") : "yearly",
    currency: (params.get("currency") || "").toUpperCase(),
    quote: null,
    me: null
  };

  // ---------- helpers ----------
  function money(minor, currency) {
    const v = minor / 100;
    try {
      return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
        maximumFractionDigits: 2
      }).format(v);
    } catch (_) {
      return `${currency} ${v.toFixed(2)}`;
    }
  }

  function longDate(ms) {
    return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.body ? "POST" : opts.method || "GET",
      credentials: "same-origin",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {}
    if (!res.ok && res.status !== 202) {
      const err = new Error(data.message || "Loudleaf couldn't reach the server. Check your connection and try again.");
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return { status: res.status, ...data };
  }

  function show(step) {
    ["stepSignin", "stepPay", "stepWorking", "stepDone"].forEach((id) => ($(id).hidden = id !== step));
  }

  function showError(msg) {
    const el = $("coError");
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      if (label) btn.textContent = label;
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  }

  function cleanUrl() {
    const keep = new URLSearchParams({ term: state.term });
    if (state.currency) keep.set("currency", state.currency);
    history.replaceState(null, "", `${location.pathname}?${keep}`);
  }

  function notifyExtension() {
    try {
      if (extId && window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(extId, { type: "LOUDLEAF_PLAN_CHANGED" }, () => void chrome.runtime.lastError);
      }
    } catch (_) {}
  }

  // ---------- render ----------
  function renderPrices() {
    const q = state.quote;
    if (!q) return;
    const t = q.quotes[state.term];
    $("coTotal").textContent = money(t.totalMinor, t.currency);
    $("coPer").textContent = PER[state.term];
    $("coItemName").textContent = `Loudleaf Pro · ${t.label}`;
    $("coItemPrice").textContent = money(t.subtotalMinor, t.currency);
    $("coSubtotal").textContent = money(t.subtotalMinor, t.currency);
    $("coTaxLabel").textContent = t.taxRate ? `${t.taxLabel} (${t.taxRate}%)` : "Tax";
    $("coTax").textContent = t.taxRate ? money(t.taxMinor, t.currency) : money(0, t.currency);
    $("coDue").textContent = money(t.totalMinor, t.currency);

    let tip = "";
    if (state.term === "yearly") {
      const monthly = q.quotes.monthly;
      const save = Math.round((1 - t.subtotalMinor / (monthly.subtotalMinor * 12)) * 100);
      tip = `Smart pick · about ${money(Math.round(t.totalMinor / 12), t.currency)} per month${save > 0 ? `, ${save}% less than monthly` : ""}`;
    } else if (state.term === "lifetime") {
      tip = "Pay once · Pro and every future update";
    }
    $("coTip").textContent = tip;

    $("coFine").textContent =
      state.term === "lifetime"
        ? "Pro turns on the moment your payment is confirmed. No renewals, ever."
        : `Pro turns on the moment your payment is confirmed and runs for ${state.term === "monthly" ? "30 days" : "365 days"}. Nothing renews automatically. We'll show the end date, and Loudleaf switches back to Free after it, with unlimited listening up to 1.5×.`;

    document.querySelectorAll(".co-pills button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.term === state.term)));

    const seg = $("coCurrency");
    if (q.currencies.length > 1) {
      seg.innerHTML = "";
      q.currencies.forEach((c) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(c === q.currency));
        b.dataset.currency = c;
        b.textContent = c;
        seg.appendChild(b);
      });
    } else seg.innerHTML = "";

    const mode = $("coMode");
    mode.hidden = false;
    mode.classList.toggle("is-test", q.paypalEnv !== "live");
    mode.textContent =
      q.paypalEnv === "live" ? "Live payments · verified by PayPal and Razorpay" : "Test mode · no real money moves";

    // PayPal caption: INR buyers pay the USD price through PayPal
    const pq = q.paypalQuotes && q.paypalQuotes[state.term];
    $("paypalSub").textContent = pq ? `Pays ${money(pq.totalMinor, pq.currency)} in ${pq.currency}` : `Pays ${money(t.totalMinor, t.currency)}`;
    $("coCard").setAttribute("aria-busy", "false");
  }

  function renderAccount() {
    const me = state.me;
    if (!me || !me.signedIn) {
      const next = `/checkout.html?term=${state.term}${state.currency ? `&currency=${state.currency}` : ""}`;
      $("googleBtn").href = `/api/auth/login?next=${encodeURIComponent(next)}`;
      show("stepSignin");
      return;
    }
    $("coName").textContent = me.name || me.email;
    const av = $("coAvatar");
    if (me.avatar && /^https:\/\/[\w.-]+\.googleusercontent\.com\//.test(me.avatar)) {
      av.src = me.avatar;
      av.hidden = false;
    }
    $("coPlanNow").textContent =
      me.plan === "pro"
        ? me.expiresAt
          ? `Pro until ${longDate(me.expiresAt)} · buying again adds time`
          : "Pro · Lifetime"
        : `Free plan · ${me.email}`;
    const email = $("billingEmail");
    if (!email.value) email.value = me.email || "";

    const p = state.quote ? state.quote.providers : {};
    const lifetimeOwned = me.plan === "pro" && !me.expiresAt;
    $("paypalBtn").hidden = !p.paypal || lifetimeOwned;
    $("razorpayQuick").hidden = true;
    $("coDivider").hidden = !p.razorpay || lifetimeOwned;
    $("rzpBlock").hidden = !p.razorpay || lifetimeOwned;
    $("noProviders").hidden = !!(p.paypal || p.razorpay) || lifetimeOwned;
    if (lifetimeOwned) showError("");
    if (lifetimeOwned) $("coPlanNow").textContent = "You already own Loudleaf Pro for life. Nothing more to buy.";
    show("stepPay");
  }

  // ---------- data ----------
  async function loadQuote() {
    const q = await api(`/api/checkout/quote${state.currency ? `?currency=${encodeURIComponent(state.currency)}` : ""}`);
    state.quote = q;
    state.currency = q.currency;
    renderPrices();
  }

  async function loadMe() {
    state.me = await api("/api/me").catch(() => ({ signedIn: false }));
  }

  // ---------- PayPal ----------
  async function payWithPaypal() {
    showError("");
    const btn = $("paypalBtn");
    busy(btn, true, "Opening PayPal…");
    try {
      const r = await api("/api/paypal/create-order", { body: { term: state.term, currency: state.currency } });
      location.assign(r.approveUrl);
    } catch (e) {
      busy(btn, false);
      if (e.status === 401) return refreshAll();
      showError(e.message);
    }
  }

  async function capturePaypal(orderId) {
    show("stepWorking");
    $("workingTitle").textContent = "Confirming your PayPal payment…";
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const r = await api("/api/paypal/capture-order", { body: { orderId } });
        if (r.status === 202) {
          $("workingText").textContent = r.message || "PayPal is still confirming. This can take a minute.";
          await new Promise((res) => setTimeout(res, 4000));
          continue;
        }
        return finish(r);
      } catch (e) {
        await loadMe();
        renderAccount();
        showError(e.message);
        return;
      }
    }
    renderAccount();
    showError("PayPal hasn't confirmed yet. Your plan updates automatically once it does, even if you close this page.");
  }

  // ---------- Razorpay ----------
  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Razorpay didn't load. Check your connection or turn off content blockers for this page."));
      document.head.appendChild(s);
    });
  }

  async function payWithRazorpay(btn) {
    showError("");
    const email = $("billingEmail");
    if (email.value && !email.checkValidity()) {
      email.setAttribute("aria-invalid", "true");
      showError("Enter a valid billing email, like name@example.com.");
      email.focus();
      return;
    }
    email.removeAttribute("aria-invalid");
    busy(btn, true, "Opening Razorpay…");
    try {
      await loadRazorpay();
      const o = await api("/api/razorpay/create", { body: { term: state.term, currency: state.currency } });
      const rzp = new window.Razorpay({
        key: o.keyId,
        order_id: o.orderId,
        amount: o.amount,
        currency: o.currency,
        name: "Loudleaf Pro",
        description: `Loudleaf Pro · ${state.quote.quotes[state.term].label}`,
        image: `${location.origin}/assets/logo.png`,
        prefill: { email: email.value || o.email, name: o.name },
        theme: { color: "#2f6b2a" },
        modal: { ondismiss: () => busy(btn, false) },
        handler: async (resp) => {
          show("stepWorking");
          $("workingTitle").textContent = "Confirming your payment…";
          try {
            const r = await api("/api/razorpay/verify", {
              body: { orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature }
            });
            finish(r);
          } catch (e) {
            await loadMe();
            renderAccount();
            busy(btn, false);
            showError(e.message);
          }
        }
      });
      rzp.on("payment.failed", (r) => {
        busy(btn, false);
        const reason = r && r.error && r.error.description;
        showError(`${reason ? reason + " " : ""}You weren't charged, and your plan hasn't changed.`);
      });
      rzp.open();
    } catch (e) {
      busy(btn, false);
      if (e.status === 401) return refreshAll();
      showError(e.message);
    }
  }

  // ---------- done ----------
  function finish(r) {
    state.me = { ...(state.me || {}), plan: r.plan, term: r.term, expiresAt: r.expiresAt };
    $("doneText").textContent =
      r.term === "lifetime" || !r.expiresAt
        ? "Lifetime Pro is yours. No renewals, ever."
        : `Your ${r.term === "monthly" ? "monthly" : "yearly"} plan is active until ${longDate(r.expiresAt)}. After that, Loudleaf switches back to Free and keeps your settings.`;
    show("stepDone");
    notifyExtension();
  }

  async function refreshAll() {
    await Promise.all([loadQuote().catch((e) => showError(e.message)), loadMe()]);
    renderAccount();
  }

  // ---------- events ----------
  document.querySelector(".co-pills").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-term]");
    if (!b) return;
    state.term = b.dataset.term;
    renderPrices();
    renderAccount();
    cleanUrl();
  });
  document.querySelector(".co-pills").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TERMS.indexOf(state.term);
    state.term = TERMS[(i + (e.key === "ArrowRight" ? 1 : TERMS.length - 1)) % TERMS.length];
    renderPrices();
    document.querySelector(`.co-pills [data-term="${state.term}"]`).focus();
    cleanUrl();
  });
  $("coCurrency").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-currency]");
    if (!b || b.dataset.currency === state.currency) return;
    state.currency = b.dataset.currency;
    await loadQuote().catch((err) => showError(err.message));
    renderAccount();
    cleanUrl();
  });
  $("paypalBtn").addEventListener("click", payWithPaypal);
  $("razorpayBtn").addEventListener("click", (e) => payWithRazorpay(e.currentTarget));
  $("signOutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { body: {} }).catch(() => {});
    state.me = { signedIn: false };
    notifyExtension();
    renderAccount();
  });

  // ---------- boot ----------
  (async function boot() {
    const paypal = params.get("paypal");
    const orderId = params.get("token");
    const signin = params.get("signin");
    await refreshAll();
    if (signin === "ok") notifyExtension();
    if (signin === "failed") showError("Google sign-in didn't finish. Try again, and allow pop-ups for this site if Chrome asks.");
    if (paypal === "return" && orderId && state.me && state.me.signedIn) {
      cleanUrl();
      await capturePaypal(orderId);
    } else if (paypal === "cancel") {
      cleanUrl();
      showError("You left PayPal before paying. Nothing was charged. Pick a way to pay whenever you're ready.");
    } else if (params.has("signin")) cleanUrl();
  })();
})();

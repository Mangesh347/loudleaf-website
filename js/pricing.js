// Pricing page: live prices in the visitor's currency (from /api/checkout/quote), and a CTA that
// carries the chosen term + currency to checkout. Payment itself happens only on checkout.html.
(function () {
  "use strict";

  const TERMS = ["monthly", "yearly", "lifetime"];
  const PER = { monthly: "/month", yearly: "/year", lifetime: " once" };
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const state = {
    term: TERMS.includes(params.get("term")) ? params.get("term") : "yearly",
    currency: (params.get("currency") || "").toUpperCase(),
    quote: null
  };
  const ext = params.get("ext");

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

  function render() {
    document.querySelectorAll("#termSeg [data-term]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.term === state.term)));
    const q = state.quote;
    const cta = new URLSearchParams({ term: state.term });
    if (state.currency) cta.set("currency", state.currency);
    if (ext && /^[a-p]{32}$/.test(ext)) cta.set("ext", ext);
    $("proCta").href = `checkout.html?${cta}`;
    if (!q) return;

    const t = q.quotes[state.term];
    $("proAmount").textContent = money(t.subtotalMinor, t.currency);
    $("proPer").textContent = PER[state.term];
    $("proPriceNote").textContent = t.taxRate
      ? `+ ${t.taxRate}% ${t.taxLabel} · ${money(t.totalMinor, t.currency)} total`
      : state.term === "lifetime"
        ? "Pay once. Pro for good."
        : `${state.term === "monthly" ? "30" : "365"} days of Pro. No auto-renewal.`;

    const m = q.quotes.monthly.subtotalMinor * 12;
    const save = Math.round((1 - q.quotes.yearly.subtotalMinor / m) * 100);
    const chip = $("yearlySave");
    chip.hidden = !(save > 0);
    chip.textContent = `Save ${save}%`;

    const seg = $("currencySeg");
    seg.hidden = q.currencies.length < 2;
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
  }

  async function load() {
    try {
      const r = await fetch(`/api/checkout/quote${state.currency ? `?currency=${encodeURIComponent(state.currency)}` : ""}`);
      const q = await r.json();
      if (!q.ok) throw new Error();
      state.quote = q;
      state.currency = q.currency;
    } catch (_) {
      // Offline or API down: keep the USD list prices so the page still says something true.
      state.quote = {
        currency: "USD",
        currencies: ["USD"],
        quotes: {
          monthly: { subtotalMinor: 499, totalMinor: 499, currency: "USD", taxRate: 0 },
          yearly: { subtotalMinor: 3900, totalMinor: 3900, currency: "USD", taxRate: 0 },
          lifetime: { subtotalMinor: 7900, totalMinor: 7900, currency: "USD", taxRate: 0 }
        }
      };
    }
    render();
  }

  $("termSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-term]");
    if (!b) return;
    state.term = b.dataset.term;
    render();
  });
  $("currencySeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-currency]");
    if (!b || b.dataset.currency === state.currency) return;
    state.currency = b.dataset.currency;
    load();
  });

  render();
  load();
})();

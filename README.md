# Loudleaf website + API

Static pages (landing, pricing, checkout, legal, support, uninstall survey) and zero-dependency
Vercel functions in `api/` for Google sign-in, prices with tax, PayPal/Razorpay checkout,
webhooks, and the daily plan-expiry cron. Plans live in Supabase (`../supabase/migrations/`).

## Run locally

```bash
npm test                     # API tests with fake Supabase, PayPal and Razorpay
LOUDLEAF_DEV=1 npm run dev   # http://localhost:8765 (allows http cookies and ?country=IN)
node scripts/build-pages.js  # regenerate privacy/terms/refund/support/uninstall pages
```

Put local env vars in `.env.local` (gitignored). See `.env.example` for the list.

## Deploy

Vercel project with **Root Directory = `website`**. `vercel.json` adds the cron and security
headers. Full checklist: `../LAUNCH.md`.

## One-line settings to update after publishing

- `js/site.js and js/common.js` → `STORE_URL` (Chrome Web Store link for every "Add to Chrome" button)
- `js/checkout.js` → `STORE_EXTENSION_ID`
- Vercel env `EXTENSION_IDS` → the store item ID

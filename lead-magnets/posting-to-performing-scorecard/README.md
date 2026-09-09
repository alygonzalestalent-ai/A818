# Posting to Performing Scorecard

AGENCY818's lead magnet: a 20-question content diagnostic that scores a brand
across five pillars, hands back a real prescription, and qualifies the person
who filled it in.

`index.html` is the whole thing. One file, no build step, no dependencies
beyond two Google Fonts. Drop it on a subdomain and it works.

## Why this instead of a PDF checklist

A downloadable checklist collects addresses. This collects *diagnosed* addresses.
Three things are doing the qualifying:

1. **Effort as a filter.** Twenty questions with written, specific options.
   Someone idly collecting freebies quits at pillar two. Someone with a real
   content problem finishes, because the questions describe their week.
2. **The answers are the qualification.** By the time the form appears you
   already know their weakest pillar, their production setup, their category,
   their budget band, and their timeline. That is a briefed lead, not an email.
3. **Split routing.** Budget and timing decide which ending the visitor sees.
   Qualified prospects get invited to a call. Everyone else gets the plan and a
   standing invitation, without a fake scarcity push.

## Configure

Everything you need to change sits in one `CONFIG` block at the top of the
`<script>` in `index.html`:

```js
const CONFIG = {
  endpoint: null,                       // POST target for the lead JSON
  bookingUrl: null,                     // your scheduler
  contactEmail: "info@agency-818.com",  // fallback destination
  studio: "AGENCY818"
};
```

- `endpoint` — any URL that accepts `POST` with a JSON body. A HubSpot Forms
  API endpoint, a Zapier or Make catch hook, a Netlify or Vercel function.
  Leave it `null` and nothing breaks: the visitor still gets their results, and
  the closing button becomes a `mailto` that arrives with their full score in
  the body.
- `bookingUrl` — your scheduler. Qualified leads get it as the primary button.
  Leave it `null` and they get the `mailto` instead, so there are never dead links.
- `contactEmail` — where the fallback mail lands. Confirm this before you
  publish anywhere public.

## The payload

Every submission posts this shape:

```json
{
  "firstName": "...", "email": "...", "brand": "...", "handle": "...",
  "category": "Beauty", "producedBy": "The founder",
  "investment": "$4k to $8k", "timeline": "Ready now",
  "score": 42, "tier": "Compounding",
  "pillars": { "pov": 9, "visual": 6, "engine": 10, "path": 7, "signal": 10 },
  "weakestPillar": "Visual System",
  "qualified": true,
  "submittedAt": "2026-09-09T00:00:00.000Z"
}
```

Map `score`, `tier`, `weakestPillar`, and the five pillar integers to custom
contact properties in the CRM. They are what makes the follow-up specific, and
specificity is the whole reason this converts. See `campaign.md` for the
routing rules and the follow-up sequence built on these fields.

`qualified` is the page's own read: AGENCY818 engagements begin at **$4k a
month**, so a lead qualifies only when the investment band is $4k or above and
the timeline is this quarter or sooner. Treat it as a routing hint, not a
verdict. If the price changes, change it in `qualified()` and in the band
options together, or the two drift apart.

## Hosting

Static. Anywhere.

```
scorecard.agency-818.com  ->  index.html
```

The page has no analytics in it by choice. Add your own tag in the `<head>`
if you want funnel data, and track four events: `start`, `pillar_complete`,
`results_view`, `lead_submit`. Drop-off between `results_view` and
`lead_submit` is the number to watch.

## Publishing it as a Claude Artifact

The artifact wrapper supplies its own `<!doctype>`, `<head>`, and `<body>`, so
publish the file with those stripped:

```bash
python3 - <<'PY'
s = open("index.html").read()
s = s.split("<head>", 1)[1].replace("</head>\n<body>\n", "", 1).rsplit("</body>", 1)[0]
open("/tmp/scorecard.artifact.html", "w").write(s.strip() + "\n")
PY
```

Artifacts cannot make outbound network requests, so `endpoint` stays `null`
there and the `mailto` path carries the lead. Use the artifact for sharing and
review. Use your own domain for the campaign.

## Editing the questions

`PILLARS` in the script holds everything: pillar names, the diagnostic blurb,
the three prescribed moves, and four questions each with four options ordered
worst to best, scored 0 through 3. Keep four options per question or the
60-point scale and the tier thresholds in `TIERS` stop lining up.

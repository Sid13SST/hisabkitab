# HisabKitab · Kirana ka back office

HisabKitab is a back office for a **solo kirana store owner** who runs the shop alone. It answers three daily questions:

1. **Who owes me, how much, and since when?**
2. **Will I have enough cash for rent, suppliers and salary over the next 30 to 90 days?**
3. **What happens if a big customer pays late?**

It was built for the ACE Builders Hackathon 2026, Problem Statement 1: *The One-Person Back Office*.

## Features

- **Dashboard**: total receivable, overdue, money expected in the next 30 days, bills due, and projected cash. Includes an aging bar (not yet due, 1-30, 31-60, 61-90, 90+ days) with amounts and customers per bucket, plus a "who owes me" table with the outstanding amount, the overdue amount, the oldest unpaid date and number of days, and the open invoice count.
- **Customers**: add, edit and list customers by name and 10-digit phone number, with a per-customer udhaar summary.
- **Invoices**: multi-line invoices (description, qty, rate) with issue, due and expected-payment dates. You can mark an invoice sent and record partial payments. Each invoice shows an unpaid, partial or paid status chip.
- **Assisted follow-up**: every invoice with an open balance shows a drafted Hinglish reminder, with a copy button and an **Open in WhatsApp** link. The link only opens *your own* WhatsApp with the text filled in. The app never sends anything itself.
- **Bills**: upcoming bills such as rent, suppliers, electricity and salary. You can add bills and mark them paid.
- **Cash forecast**: set the opening cash and pick a 30, 60 or 90 day horizon. Shows a week-by-week inflow, outflow and closing balance with item details, a closing-cash chart, a negative-cash warning, and a note on amounts that fall beyond the horizon.
- **What-if scenario**: "What if this customer pays 15 days late?" Shows the plan next to the scenario: the change in ending cash and in lowest cash, which weeks change, and which invoices shift.
- **Alerts**: overdue invoices to chase today, bills due within 7 days, projected negative cash, invoices not yet sent, and dormant customers. Alerts are colored by severity, and the Alerts tab shows an unread badge.
- All data stays in your browser in `localStorage`. **Reset sample data** restores the demo dataset. The sample dates are generated relative to today, so the demo never goes stale.

## Run it

No build step and no dependencies.

- Open `index.html` directly in a browser, **or**
- serve this folder with any static file server (for example `npx serve .`) and open the printed URL.

## Tests

```bash
node tests/logic.test.js
```

The tests load `js/logic.js` and `js/sample-data.js` into a `node:vm` sandbox and check invoice totals, balances and status, aging buckets, receivables by customer, the 90-day forecast math, the "customer pays 15 days late" scenario, alerts, and INR formatting.

## Project layout

```
index.html          app shell and tab navigation
css/style.css       styles (mobile-friendly, light/dark)
js/logic.js         pure business logic (window.Logic)
js/sample-data.js   demo kirana dataset, generated relative to today
js/app.js           UI: storage, hash routing, rendering, forms
tests/logic.test.js dependency-free Node tests
```

## Built with

- **Core business logic** (`js/logic.js`) was generated in the **Codebenders Nexen IDE** during ACE Builders Hackathon 2026.
- The **UI, sample data and tests** were built with **Claude Code**.
- Plain HTML, CSS and JavaScript. No frameworks, CDNs or npm packages.

## Live demo

https://hisabkitab-seven.vercel.app

A browser-local kirana back-office demo with synthetic sample records. Data is stored in this browser; there is no cloud sync or automatic message sending.

## Build notes

Codebenders Nexen generated the core business logic from a brief covering invoices, partial payments, promised dates, receivables aging, 30-90 day cash forecasts, late-payment scenarios and follow-up drafts. The generated logic was retained unchanged. After IDE interruptions, Claude Code completed the interface, sample data and tests. The organizers gave permission for external AI tools by phone.

Verification included 28 automated tests and UI checks for record creation, payments, bill status, promised dates, scenarios and reload persistence. The demo is hosted on Vercel's free tier. No new purchase was made for this build.

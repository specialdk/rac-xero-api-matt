# RAC Financial Dashboard

Multi-entity Xero financial reporting platform for Rirratjingu Aboriginal Corporation (RAC), with a web dashboard for executives and an MCP server that lets Claude query live financials.

> **Not the MEX repo.** Asset / CMMS work lives in [`specialdk/rac-mex-mcp`](https://github.com/specialdk/rac-mex-mcp). This repo is the **Xero** side of the house.

## What this is

Two halves of the same system:

1. **Web dashboard** — single-page app served from `public/`, currently `index-CEO-NEW.html`. Executives use it to see consolidated and per-entity financials across the 7 RAC organisations.
2. **MCP server** — `mcp-server.js`, exposes ~20 tools to Claude Desktop / Claude Code so the finance team can ask natural-language questions of live Xero data.

Both halves talk to the same Express backend (`server.js`) which talks to Xero and PostgreSQL.

**Live deployment:** https://rac-xero-api-matt-production.up.railway.app

## Connected entities (7)

1. Rirratjingu Mining Pty Ltd
2. Rirratjingu Aboriginal Corporation
3. Rirratjingu Enterprises Pty Ltd
4. Rirratjingu Property Management & Maintenance Services Pty Ltd
5. Ngarrkuwuy Developments Pty Ltd
6. Rirratjingu Invest P/L ATF Miliditjpi Trust
7. Marrin Square Developments Pty Ltd

All 7 share a single Xero OAuth app and therefore share refresh tokens (see *Gotchas* below).

## Repo map

```
rac-xero-api-matt/
├── server.js               Express API + OAuth + token mgmt + endpoints
├── mcp-server.js           MCP server for Claude Desktop
├── public/
│   ├── index-CEO-NEW.html  ← active dashboard
│   └── login-manager.html  entry point — redirects to /dashboard
├── lib/                    shared helpers
├── migrations/             PostgreSQL schema
├── docs/                   internal docs and SOPs
├── CLAUDE.md               agent-facing brief (read this first if you're Claude)
├── CLEAN_UP.md             deferred tech debt + known polish items
├── serverOLD.js            previous server.js — kept for reference, do not edit
└── README.md               this file
```

## Stack

- **Backend:** Node.js ≥ 18, Express, ES modules
- **Database:** PostgreSQL (Railway-hosted) — tables include `tokens`, `reversal_overrides`, `daily_metrics`, `monthly_snapshots`
- **Frontend:** plain HTML / CSS / vanilla JS (no build step)
- **Hosting:** Railway (auto-deploy on push to `main`)
- **Accounting:** Xero (xero-node SDK)
- **AI:** Anthropic API (Claude) powers the dashboard's AI Chat panel; MCP server exposes data to Claude Desktop separately

## What it can do

**Dashboard cards:**
- Multi-entity P&L, Balance Sheet, Cash Position, Key Ratios
- Receivables, Top Customers, Aged Debtors
- Sparklines and trend charts from historical snapshots (Jul 2025 onwards)
- Production card (Mining only) — SOH, QTD Sold, pending Orders
- Inventory card — pulls from `rac-inventory-production.up.railway.app`
- AI Chat panel (always visible) — pulls live data, reversal-aware

**Reversal Journals system:**
Matt can mark journals to include/exclude via checkboxes; decisions persist in PostgreSQL (`reversal_overrides`) and apply when the user clicks the Reversals button.

**MCP tools** (~20, see `mcp-server.js` for the full list):
`get_trial_balance`, `get_cash_position`, `get_profit_loss_summary`, `get_consolidated_trial_balance`, `get_outstanding_invoices`, `get_aged_receivables`, `get_invoices_detail`, `get_journal_entries`, `analyze_expense_categories`, `analyze_equity_movements`, `get_intercompany_transactions`, `get_financial_ratios`, `get_budget`, `get_account_history`, `check_bank_reconciliation`, `find_unbalanced_transactions`, `get_chart_of_accounts`, `compare_periods`, `investigate_imbalance`, `get_organizations`, `test_rac_connection`.

## Setup

```bash
git clone https://github.com/specialdk/rac-xero-api-matt.git
cd rac-xero-api-matt
npm install
cp .env.example .env   # then fill in credentials
npm run dev            # or: npm start
```

### Environment variables

Required:
- `DATABASE_URL` — PostgreSQL connection string
- `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`
- `RAILWAY_API_URL` — used by the MCP server to call the API
- `ANTHROPIC_API_KEY` — used by the AI Chat panel
- `PORT` (defaults to 3000)

Optional:
- `APPROVALMAX_CLIENT_ID`, `APPROVALMAX_CLIENT_SECRET`, `APPROVALMAX_REDIRECT_URI` — only if/when ApprovalMax integration is enabled

### Claude Desktop MCP config

```json
{
  "mcpServers": {
    "rac-xero": {
      "command": "node",
      "args": ["C:/path/to/rac-xero-api-matt/mcp-server.js"],
      "env": {
        "RAILWAY_API_URL": "https://rac-xero-api-matt-production.up.railway.app"
      }
    }
  }
}
```

## Routing

1. User hits `login-manager.html`
2. Authenticates → redirected to `/dashboard`
3. `/dashboard` serves `index-CEO-NEW.html`

`index.html` in `/public` is retired and can be deleted (see CLEAN_UP.md).

## Gotchas (things that will bite you)

Documented in more detail in CLAUDE.md and inline in the code, but heads-up:

- **Xero refresh tokens are single-use and shared across all 7 entities.** When refreshing, update *every* row with `WHERE provider = 'xero'`, never per-tenant. Consuming the token for one tenant invalidates it for all of them.
- **Outstanding invoices API returns both ACCREC and ACCPAY by default.** Always filter explicitly with `invoiceType: 'ACCREC'` for receivables.
- **`periodMonths` in `get_profit_loss_summary` counts backward**, not forward. `periodMonths=3` from 2026-01-31 returns Nov–Jan.
- **Xero WHERE-clause date format** is `DateTime(2025,10,01)` with commas, not hyphens.
- **`getInvoices()` without pagination returns lightweight summaries** with empty line item arrays. Pass `page` to get line items.
- **Aged receivables aren't a summary report.** `getReportAgedReceivablesByContact` requires a specific contactId — calculate manually from `getInvoices` with status filters.
- **Organisation names: short vs full.** Dashboard uses short names ("Mining", "Property"); database uses full legal names. The `orgNameMap` in the historical-metrics endpoint is essential.
- **Historical backfill must use exact account names.** Broad matching (e.g. anything containing "receivable") will sweep in dividends-receivable etc. and corrupt sparklines.

## Financial year

- FY26 = July 2025 – June 2026
- Q1 = Jul–Sep, Q2 = Oct–Dec, Q3 = Jan–Mar, Q4 = Apr–Jun

## Companion repos

| Repo | Purpose |
|---|---|
| [rac-mex-mcp](https://github.com/specialdk/rac-mex-mcp) | MEX CMMS integration (assets, work orders) |
| [rac-inventory](https://github.com/specialdk/rac-inventory) | Quarry inventory app |
| [rac-intranet](https://github.com/specialdk/rac-intranet) | Internal RAC staff intranet |
| [rac-grants](https://github.com/specialdk/rac-grants) | Grants tracking |
| [rac-ops](https://github.com/specialdk/rac-ops) | Ops app (in progress) |
| [rac-sharepoint-rag](https://github.com/specialdk/rac-sharepoint-rag) | SharePoint RAG |

## For Claude / other AI agents working here

Start with **CLAUDE.md**. Then check **CLEAN_UP.md** for known deferred items so you don't try to "fix" something that was deliberately left alone. The active dashboard file is `public/index-CEO-NEW.html`, not `index.html`. Source of truth is this repo — not project-knowledge attachments, which may be stale.

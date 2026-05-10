# RAC Finance Dashboard — Clean-Up Backlog

Running list of technical debt and minor polish items that have been **deliberately deferred** during active development. Each item is recorded with its reason for deferral so future sessions (or future Claude) understand why it was bypassed.

This list is referenced from the project README under "Known Tech Debt".

---

## Source code hygiene

### 1. Mojibake in `server.js` console logging
**Status:** Deferred — fix organically as functions are touched.

**Detail:** ~134 lines in `server.js` contain double- or triple-encoded UTF-8 emojis that display as garbled sequences (e.g. `ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°` instead of `🚀`). All 134 are inside `console.log` / `console.error` / `console.warn` statements only.

**Why deferred:**
- Zero impact on user-facing output (AI prompts, HTTP responses, HTML are all clean).
- Only affects source code readability in VS Code and Railway log output.
- Mixed encoding patterns (some double, some triple-encoded) make a bulk find-and-replace risky — there's no single decode pattern that fixes all of them safely.
- Some escape sequences happen to contain valid template-literal characters, so a careless fix could break working code.

**Plan:** Whenever a function in `server.js` is edited for real reasons, fix the mojibake in that function's logs at the same time. If we end this approach without having touched everything, do a manual line-by-line pass at the end.

**Date logged:** 10 May 2026

---

## Polish items deferred during dashboard rebuild

### 2. Period vs Entity dropdown style alignment
**Status:** Deferred — known fiddly.

**Detail:** The Period selector is a native `<select>`; the Entity picker is a custom dropdown (button + panel). They sit side-by-side in the top control row but render with subtly different chrome and animation. We standardised the at-rest/wake-up background colours (paper → card on hover/focus/open) but the underlying control-type difference remains.

**Why deferred:** Genuine fix means rebuilding Period as a custom dropdown to match Entity's behaviour exactly, or rebuilding Entity as a native `<select>` (which loses the icons and current-tenant indicator). Either is a meaningful redesign.

**Date logged:** 10 May 2026

---

### 3. AI format pinning — partially effective, accepted as-is
**Status:** Accepted partial. Do not tighten further.

**Detail:** The system prompt was updated (10 May session) to pin response format with explicit rules:
- Lead each paragraph with a bold thesis sentence
- Use `##` headers when ranking, decomposing, or breaking a question into parts
- Bold key numbers, AU dollar formatting, 2–3 paragraphs default

After deployment, testing showed the bold thesis sentence rule lands consistently. The `##` header rule is followed inconsistently — about 80% of "ranking" questions get a header, the others use prose. Both formats are readable; the inconsistency is purely cosmetic.

**Why deferred:** Tightening further (e.g. "always use ## when listing 2+ entities") risks making responses feel rigid and over-engineered. The current state — bold thesis always, ## headers usually — is a reasonable balance between consistency and natural-sounding prose. Genuine variation (e.g. one paragraph emphasising concentration risk, another emphasising collection risk while citing identical underlying data) is also acceptable analytical voice and not a defect.

**Plan:** Leave alone unless/until a stakeholder specifically complains about formatting variation.

**Date logged:** 10 May 2026

---

### 4. AI follow-up question — auto-append "?" if missing
**Status:** Minor UX polish. Not started.

**Detail:** When the user types a follow-up question without a trailing `?` (e.g. "Who are our slowest Payers"), the AI handles it correctly but the rendered Q in the conversation log lacks the question mark. Cosmetic only — no functional impact.

**Why deferred:** Trivial frontend tweak, but rare enough that it doesn't warrant interrupting other work.

**Plan:** When next touching the AI panel input handler, normalise punctuation: trim, ensure trailing `?` for questions.

**Date logged:** 10 May 2026

---

## Data-quality and context the AI should know about

### 5. Rio Accrual not yet booked — affects April 2026 read
**Status:** Awaiting Matt to post the accrual. Not a code issue.

**Detail:** The Rio (Gove RTA Mining Agreement) revenue is RAC's largest single line — historically running ~$3M per month for two months at a time. As of 10 May 2026, Matt has not posted the accrual for the most recent period. This means the April 2026 figures in Xero materially understate true revenue, and any AI narrative built on those figures (e.g. "catastrophic revenue decline", "wind-down") is misleading the user about the underlying business reality. The mine is still producing.

**Implication:** When the AI sees a large unexplained revenue drop in any month and the entity is Aboriginal Corporation or Mining, the most likely cause is timing of the Rio accrual — not operational decline. This should be reflected in AI prompting (e.g. "If you see a large month-on-month revenue drop in RTA Mining Agreement income, note that accrual timing may be the cause and suggest verifying with Matt before drawing conclusions").

**Plan:** Once Rio Accrual posting cadence is confirmed with Matt, add a system-prompt rule that recognises this pattern. Possibly also a dashboard banner when current-month RTA Mining revenue is materially below a 3-month average — visual cue that an accrual may be pending.

**Date logged:** 10 May 2026

---

### 6. Court Outcomes — a structural shift, not a one-off
**Status:** Context for narrative, no code action.

**Detail:** "Proceeds from Court Outcomes" appeared in Aboriginal Corp's FY26 YTD revenue at $320,185. Per Duane (10 May 2026): RAC has historically spent ~$10M on legal fees over many years. With the recent court case now won, settlements are flowing back the other way. The $320K is the start of what is expected to be a transformational inflow over coming periods — "forever change this company and town" was the framing.

**Implication for the AI:** Court Outcomes revenue should NOT be treated as "miscellaneous" or "one-off noise". Treat it as a strategically meaningful new revenue stream with significant expected growth. Don't smooth it out of YoY narratives.

**Implication for the classifier:** Currently classified as OTHER. Worth considering whether this deserves its own bucket as Court Outcomes revenue grows. For v1, OTHER is fine — re-evaluate in 1–2 quarters when the trajectory is clearer.

**Date logged:** 10 May 2026

---

## Tier 5 — operational unit economics (next horizon)

### 7. Sub-account drill-down — Salaries & Wages, Cost-Materials, etc.
**Status:** Open question. Right question, no code yet.

**Detail:** Per session 10 May 2026, the AI was asked for a Salaries & Wages breakdown for Property ($848K FY26 YTD). The honest answer was correct: the Xero P&L API rolls Salaries & Wages up to a single line. To go below that line we need a different data source. Same applies to other large rolled-up accounts (Cost-Materials, Motor Vehicle Expenses, etc.).

**Three possible paths, ranked by richness:**

**(A) Bank/journal transaction detail.** Augment the P&L with the underlying transactions for each account. Easy. Gives cadence (e.g. "26 fortnightly pay runs averaging $32.6K") but no employee/pay-item breakdown. Useful for "is anything anomalous in any single month" but not for unit economics.

**(B) Xero Payroll API.** If RAC uses Xero Payroll (subscription tier separate from Xero accounting), the payroll API exposes employees, pay runs, leave, super, allowances. Possible cuts: by pay item (Base/Overtime/Allowances/Leave/Bonus), by employee (with optional name redaction), by department or cost centre if Xero Payroll tracking is configured. The richest standard answer.

**(C) Xero Payroll tracking categories.** If RAC configured Payroll tracking categories (Department: Trades/Admin/Field; or Cost Centre: DIPL Carpentry/Plumbing/Electrical), the breakdown would be pre-coded. RAC accounting tracking categories aren't in use (verified 10 May 2026 against Property and Mining invoice line items). Payroll tracking is a separate setup — needs Matt confirmation.

**Adjacent stream — Paul's time-tracking app concept.** Paul (incoming CEO) raised the idea of a time-tracking app where staff "code their day to jobs" so Wages number gets job/contract attribution. That's Option B+C combined plus a fresh ingestion layer. Strategic-grade work, not next sprint.

**Open questions for Matt:**
- Does RAC use Xero Payroll, or a separate payroll system?
- Are tracking categories configured in Xero Payroll if so?
- What's the right granularity for leadership reporting — by pay item? by department? by job/contract? all three?

**Open questions for Rhian/Paul:**
- If we could show the wages breakdown, what cuts would actually help decisions? (i.e. which dimension matters most — by pay item, by department, by job?)
- Same question for Cost-Materials and other large rolled-up accounts.

**Plan:** Discuss with Rhian/Paul during dashboard review (week of 11 May). Confirm Xero Payroll arrangement with Matt. Then choose A vs B vs C based on what the conversation surfaces. Likely B if Xero Payroll is in use; A as a tactical fill-in either way.

**Date logged:** 10 May 2026

---

(Items added below as session continues)
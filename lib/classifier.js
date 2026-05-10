// Procurement classifier
// File: classifier.js
//
// Single source of truth for how we sort Xero expense lines into
// procurement (IN), grey-area distributions (GREY), and excluded
// categories (OUT_PERSONNEL, OUT_TAX_DEPN_INT, OUT_INTERCO,
// OUT_GOVERNANCE).
//
// Stress-tested against all 7 RAC entities' FY26 YTD data on 2026-05-03;
// totals reconciled cleanly in every case. See SAMPLING_FINDINGS.md /
// chat history for the methodology discussion.
//
// Buckets:
//   IN                  Real third-party procurement spend
//   GREY_DISTRIB        Direct distributions to families / donations / grant payments
//   OUT_PERSONNEL       Wages, super, payroll tax, FBT, leave, recruitment, allowances
//   OUT_TAX_DEPN_INT    Depreciation, amortisation, interest, bank charges, GST,
//                       impairment, currency, bad debts, write-offs
//   OUT_INTERCO         Management Fee - RAC, intercompany, future-fund transfers,
//                       distributions payable
//   OUT_GOVERNANCE      Sitting fees, director fees, chairman fees

const BUCKETS = ['IN', 'GREY_DISTRIB', 'OUT_PERSONNEL', 'OUT_TAX_DEPN_INT', 'OUT_INTERCO', 'OUT_GOVERNANCE'];

// Patterns are deliberately broad — RAC has 400+ accounts across the 7
// entities and naming is inconsistent (e.g. "Wages & Salaries",
// "Salaries & Wages", "Wages Indigenous Employ program"). Substring
// matching against well-chosen tokens is more robust than account-code
// matching, which would force us to maintain a per-entity lookup table.
function classify(accountName) {
    if (!accountName) return 'IN';
    const n = String(accountName).toLowerCase();

    // OUT — Personnel costs (wages, super, payroll tax, FBT, LSL, recruitment)
    if (/wage|salar|superannu|payroll tax|fringe benefit|long service|annual leave|lsl|recruit|relocation/.test(n)) return 'OUT_PERSONNEL';

    // OUT — Allowances paid to staff (cash, not vendor procurement)
    if (/travel allowance|housing allowance/.test(n)) return 'OUT_PERSONNEL';

    // OUT — Tax / Depreciation / Interest / Bank charges / Currency / Impairment
    if (/depreciation|amortis|amortiz/.test(n)) return 'OUT_TAX_DEPN_INT';
    if (/interest (expense|paid)|lease interest/.test(n)) return 'OUT_TAX_DEPN_INT';
    if (/bank charge|bank fee/.test(n)) return 'OUT_TAX_DEPN_INT';
    if (/gst paid|gst received/.test(n)) return 'OUT_TAX_DEPN_INT';
    if (/loss on (disposal|sale)|impairment|write off|writeoff|currency/.test(n)) return 'OUT_TAX_DEPN_INT';
    if (/bad debt/.test(n)) return 'OUT_TAX_DEPN_INT';

    // OUT — Intercompany / cross-charges
    if (/management fee.*rac|inter[ -]?entity|inter[ -]?company/.test(n)) return 'OUT_INTERCO';
    if (/^re - (cost recovery|wage recovery)/.test(n)) return 'OUT_INTERCO';
    if (/transfer to future|future charitable payment/.test(n)) return 'OUT_INTERCO';
    if (/dividend paid|distribution.*payable|dist - bun/.test(n)) return 'OUT_INTERCO';

    // OUT — Director / governance fees
    if (/sitting fee|director.*fee|chairman fee/.test(n)) return 'OUT_GOVERNANCE';

    // GREY — Direct distributions / donations / grant payments
    if (/family charitable payment|family group payment/.test(n)) return 'GREY_DISTRIB';
    if (/^donations?$/.test(n)) return 'GREY_DISTRIB';
    if (/grant payments?$/.test(n)) return 'GREY_DISTRIB';

    // Everything else = IN (procurement)
    return 'IN';
}

// Summarise an array of { accountName, amount } expense categories into
// per-bucket totals plus a few derived figures the dashboard wants.
function summarise(expenseCategories) {
    const totals = Object.fromEntries(BUCKETS.map(b => [b, 0]));
    const detailed = Object.fromEntries(BUCKETS.map(b => [b, []]));

    for (const c of expenseCategories || []) {
        const amount = Number(c.amount) || 0;
        const bucket = classify(c.accountName);
        totals[bucket] += amount;
        detailed[bucket].push({ name: c.accountName, amount });
    }

    const totalExpenses = Object.values(totals).reduce((a, b) => a + b, 0);

    // Round each bucket to 2dp once at the end — avoids floating-point
    // drift accumulated across many additions.
    const r2 = n => Math.round(n * 100) / 100;
    const cleanTotals = Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [k, r2(v)])
    );

    // Procurement-IN as a percentage of total expenses, with sensible
    // fallback for zero-total entities (Marrin Square, Ngarrkuwuy).
    const inPct = totalExpenses > 0
        ? Math.round((totals.IN / totalExpenses) * 1000) / 10
        : 0;

    return {
        totalExpenses: r2(totalExpenses),
        totals: cleanTotals,
        detailed,
        inPct,
        // Convenience aggregates for the front-end's bar visualisation
        outPersonnel: cleanTotals.OUT_PERSONNEL,
        outTaxDepnInt: cleanTotals.OUT_TAX_DEPN_INT,
        outInterco: cleanTotals.OUT_INTERCO,
        outGovernance: cleanTotals.OUT_GOVERNANCE,
        outTotal: r2(cleanTotals.OUT_PERSONNEL + cleanTotals.OUT_TAX_DEPN_INT + cleanTotals.OUT_INTERCO + cleanTotals.OUT_GOVERNANCE),
        greyTotal: cleanTotals.GREY_DISTRIB,
        inTotal: cleanTotals.IN
    };
}

export { classify, summarise, BUCKETS  };
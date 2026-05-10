// Revenue classifier
// File: revenue-classifier.js
//
// Single source of truth for how we sort Xero revenue lines into
// meaningful buckets — core trading revenue vs investment returns vs
// royalty/agreement income vs grants vs rentals vs intercompany.
//
// Mirror of classifier.js (procurement) — same module shape, same
// substring-matching philosophy. Built and stress-tested against
// real FY26 YTD revenue accounts from Aboriginal Corp ($11.5M) and
// Mining ($2.1M) — two very different revenue profiles.
//
// Buckets:
//   CORE_OPERATIONS    Trading/services revenue (Sales - Quarry, Haulage,
//                      Weighbridge, Property maintenance, etc.) — the
//                      "what the business actually does" line
//   MINING_AGREEMENTS  Gove RTA Mining Agreement, Statutory s64 Royalties
//                      and royalty-related interest. RAC's largest single
//                      revenue stream — deserves its own bucket.
//   INVESTMENT_INCOME  Macquarie + Morgans funds (distributions, market
//                      value adjustments, gain/loss on sale, adviser
//                      fees), dividends, interest on term deposits and
//                      loans receivable
//   GRANT_INCOME       Government grants (NIAA, ISEP, Remote Jobs
//                      Program, Manikay & Bunggul), tax credits
//                      (Income Tax Credit, Fuel Tax Credits)
//   RENTAL_INCOME      Property rentals — commercial, residential,
//                      store rent, room hire
//   INTERCO_REVENUE    Management fee cross-charges from related entities
//   OTHER              Fall-through bucket (Sundry Income, Misc Income,
//                      one-offs like Court Outcomes, Sponsorship). The
//                      goal is to keep this small. Anything large landing
//                      here is a signal we need a new pattern.

const REVENUE_BUCKETS = ['CORE_OPERATIONS', 'MINING_AGREEMENTS', 'INVESTMENT_INCOME', 'GRANT_INCOME', 'RENTAL_INCOME', 'INTERCO_REVENUE', 'OTHER'];

// Order matters — first match wins. Most specific patterns checked first
// (Mining Agreements, Investments, Grants) before broader ones, with
// OTHER as the explicit safety-net default rather than an opinionated
// guess. Same philosophy as the procurement classifier.
function classifyRevenue(accountName) {
    if (!accountName) return 'OTHER';
    const n = String(accountName).toLowerCase();

    // MINING_AGREEMENTS — Royalties and the RTA Mining Agreement
    // (RAC Aboriginal Corp's biggest line — ~$8M of $11.5M revenue YTD)
    if (/royalty|royalties/.test(n)) return 'MINING_AGREEMENTS';
    if (/mining ag(mt|reement)|rta mining/.test(n)) return 'MINING_AGREEMENTS';
    if (/interest received.*(royalt|accrued royalt)/.test(n)) return 'MINING_AGREEMENTS';

    // INVESTMENT_INCOME — Macquarie and Morgans portfolios, dividends,
    // term-deposit interest, related "Outgoings" adviser/admin fees
    // that net against investment returns
    if (/macquarie|morgan/.test(n)) return 'INVESTMENT_INCOME';
    if (/\bdividend/.test(n)) return 'INVESTMENT_INCOME';
    if (/term deposit|interest received.*loan|interest received.*enterprises/.test(n)) return 'INVESTMENT_INCOME';
    if (/^interest received$/.test(n)) return 'INVESTMENT_INCOME';
    if (/gain\/?\s?loss on (sell|sale|disposal)/.test(n)) return 'INVESTMENT_INCOME';
    if (/market value adjust/.test(n)) return 'INVESTMENT_INCOME';
    if (/distribution received/.test(n)) return 'INVESTMENT_INCOME';
    if (/^outgoings.*(adviser|administration|admin) fee/.test(n)) return 'INVESTMENT_INCOME';

    // GRANT_INCOME — Government grants and tax credits (refunds from
    // government count here too — same "external public funding" character)
    if (/\bgrant\b/.test(n)) return 'GRANT_INCOME';
    if (/niaa|isep/.test(n)) return 'GRANT_INCOME';
    if (/tax credit|tax benefit/.test(n)) return 'GRANT_INCOME';
    if (/\bfunding\b/.test(n)) return 'GRANT_INCOME';
    if (/wage subsidy|payg subsidy/.test(n)) return 'GRANT_INCOME';
    if (/seniors month|remote jobs.*program|remote jobs and development|manikay.*bunggul/.test(n)) return 'GRANT_INCOME';

    // RENTAL_INCOME — Property rentals across all entities
    if (/rental income|rent income/.test(n)) return 'RENTAL_INCOME';
    if (/store rent|office rent|building rent/.test(n)) return 'RENTAL_INCOME';
    if (/room hire|venue hire|hall hire/.test(n)) return 'RENTAL_INCOME';

    // INTERCO_REVENUE — Cross-charges between RAC entities
    if (/management fee.*cross|management fee cross charge/.test(n)) return 'INTERCO_REVENUE';
    if (/inter[ -]?company|inter[ -]?entity/.test(n)) return 'INTERCO_REVENUE';

    // CORE_OPERATIONS — explicit positive matches for trading/services
    // revenue. Order: most distinctive first.
    if (/^sales\b|^sale -|^sale\b/.test(n)) return 'CORE_OPERATIONS';
    if (/haulage|weighbridge/.test(n)) return 'CORE_OPERATIONS';
    if (/cost recovery|fuel cost recovery|recovery of/.test(n)) return 'CORE_OPERATIONS';
    if (/parts.*labour|parts and labour/.test(n)) return 'CORE_OPERATIONS';
    if (/repairs revenue|service revenue|labour revenue/.test(n)) return 'CORE_OPERATIONS';

    // OTHER — explicit default. Sundry, Miscellaneous, Court Outcomes,
    // Sponsorship, Camping Fees, Cultural Training fees, etc.
    return 'OTHER';
}

// Summarise revenue accounts into per-bucket totals plus dashboard-ready
// derived figures. Mirrors the structure of the procurement summarise().
function summariseRevenue(revenueAccounts) {
    const totals = Object.fromEntries(REVENUE_BUCKETS.map(b => [b, 0]));
    const detailed = Object.fromEntries(REVENUE_BUCKETS.map(b => [b, []]));

    for (const r of revenueAccounts || []) {
        // Accept either {accountName, amount} or {name, amount} — Xero's
        // P&L summary uses 'name', the procurement classifier convention
        // uses 'accountName'. Either works.
        const accountName = r.accountName || r.name;
        const amount = Number(r.amount) || 0;
        const bucket = classifyRevenue(accountName);
        totals[bucket] += amount;
        detailed[bucket].push({ name: accountName, amount });
    }

    // Note: revenue can include negative line items (market value
    // adjustments, fee outgoings). We sum signed amounts so the bucket
    // total reflects the NET contribution, which is what matters for a
    // revenue mix view.
    const totalRevenue = Object.values(totals).reduce((a, b) => a + b, 0);

    const r2 = n => Math.round(n * 100) / 100;
    const cleanTotals = Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [k, r2(v)])
    );

    // Percentage of total revenue for each meaningful bucket. Useful for
    // narrative ("Aboriginal Corp is 70% royalty-dependent",
    // "Mining is 95% core operations").
    const pct = (n) => totalRevenue !== 0 ? Math.round((n / totalRevenue) * 1000) / 10 : 0;

    return {
        totalRevenue: r2(totalRevenue),
        totals: cleanTotals,
        detailed,
        // Convenience: percentage of total for each bucket
        corePct: pct(totals.CORE_OPERATIONS),
        royaltyPct: pct(totals.MINING_AGREEMENTS),
        investmentPct: pct(totals.INVESTMENT_INCOME),
        grantPct: pct(totals.GRANT_INCOME),
        rentalPct: pct(totals.RENTAL_INCOME),
        intercoPct: pct(totals.INTERCO_REVENUE),
        otherPct: pct(totals.OTHER),
        // Convenience aggregates for visualisations
        coreTotal: cleanTotals.CORE_OPERATIONS,
        royaltyTotal: cleanTotals.MINING_AGREEMENTS,
        investmentTotal: cleanTotals.INVESTMENT_INCOME,
        grantTotal: cleanTotals.GRANT_INCOME,
        rentalTotal: cleanTotals.RENTAL_INCOME,
        intercoTotal: cleanTotals.INTERCO_REVENUE,
        otherTotal: cleanTotals.OTHER
    };
}

export { classifyRevenue, summariseRevenue, REVENUE_BUCKETS  };
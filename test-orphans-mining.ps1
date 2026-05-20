# =============================================================================
# Side-by-side test: /api/reversal-journals vs /api/orphan-reversals
#
# Runs both endpoints across Mining Q1/Q2/Q3/Q4/YTD and shows the comparison.
# Rhian's expectation: orphan counts should be ~0 for Q1, Q2, Q3 (closed
# accrual cycles) and possibly non-zero for Q4 (current period, accruals
# awaiting invoice).
# =============================================================================

$baseUrl = "https://rac-xero-api-matt-production.up.railway.app"
$org     = "Mining"

$periods = @(
    @{ name = "Q1 FY26"; from = "2025-07-01"; to = "2025-09-30" },
    @{ name = "Q2 FY26"; from = "2025-10-01"; to = "2025-12-31" },
    @{ name = "Q3 FY26"; from = "2026-01-01"; to = "2026-03-31" },
    @{ name = "Q4 FY26"; from = "2026-04-01"; to = "2026-06-30" },
    @{ name = "YTD FY26"; from = "2025-07-01"; to = "2026-05-12" }
)

Write-Host ""
Write-Host "================ MINING REVERSAL COMPARISON ================" -ForegroundColor Cyan
Write-Host ""
Write-Host ("{0,-10} {1,12} {2,14} {3,12} {4,14}" -f "Period", "OLD count", "OLD NP impact", "ORPHAN cnt", "ORPHAN NP imp") -ForegroundColor Yellow
Write-Host ("-" * 70)

foreach ($p in $periods) {
    $body = @{ organizationName = $org; dateFrom = $p.from; dateTo = $p.to } | ConvertTo-Json

    # OLD endpoint
    try {
        $oldResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/reversal-journals" `
            -ContentType "application/json" -Body $body
        $oldCount = $oldResp.reversalCount
        $oldNP    = $oldResp.plImpact.netProfitAdjustment
    } catch {
        $oldCount = "ERR"; $oldNP = "-"
    }

    # NEW endpoint
    try {
        $newResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/orphan-reversals" `
            -ContentType "application/json" -Body $body
        $newCount = $newResp.orphanCount
        $newNP    = $newResp.plImpact.netProfitAdjustment
        $matched  = $newResp.diagnostics.matchedReversalsCount
    } catch {
        $newCount = "ERR"; $newNP = "-"; $matched = "-"
    }

    Write-Host ("{0,-10} {1,12} {2,14:N2} {3,12} {4,14:N2}" -f $p.name, $oldCount, $oldNP, $newCount, $newNP)
    Write-Host ("           (matched: $matched)") -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Expectation per Rhian's rule:" -ForegroundColor Green
Write-Host "  - Q1, Q2, Q3 ORPHAN counts should be ~0 (closed cycles)"
Write-Host "  - Q4 ORPHAN count may be non-zero (current period, accruals awaiting invoice)"
Write-Host "  - YTD ORPHAN count should ~= Q4 ORPHAN count"
Write-Host ""
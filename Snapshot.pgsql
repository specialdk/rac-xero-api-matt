-- =====================================================
-- RAC XERO SNAPSHOT TABLES
-- Run this in Railway PostgreSQL console
-- =====================================================
-- Table 1: Daily metrics (balances, receivables, etc.)
-- One row per org per day, starting from today
CREATE TABLE IF NOT EXISTS daily_metrics (
    id SERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL,
    org VARCHAR(100) NOT NULL,
    
    -- Cash Position
    cash_position DECIMAL(15,2) DEFAULT 0,
    
    -- Aged Receivables
    receivables_current DECIMAL(15,2) DEFAULT 0,
    receivables_31_60 DECIMAL(15,2) DEFAULT 0,
    receivables_61_90 DECIMAL(15,2) DEFAULT 0,
    receivables_over_90 DECIMAL(15,2) DEFAULT 0,
    receivables_total DECIMAL(15,2) DEFAULT 0,
    
    -- Balance Sheet Summary
    total_assets DECIMAL(15,2) DEFAULT 0,
    total_liabilities DECIMAL(15,2) DEFAULT 0,
    total_equity DECIMAL(15,2) DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    job_status VARCHAR(20) DEFAULT 'success',
    error_message TEXT,
    
    -- Ensure one row per org per day
    UNIQUE(snapshot_date, org)
);

-- Table 2: Monthly P&L snapshots
-- One row per org per completed month
CREATE TABLE IF NOT EXISTS monthly_snapshots (
    id SERIAL PRIMARY KEY,
    period_month VARCHAR(7) NOT NULL,  -- Format: "2025-07"
    org VARCHAR(100) NOT NULL,
    
    -- P&L Summary
    revenue DECIMAL(15,2) DEFAULT 0,
    cogs DECIMAL(15,2) DEFAULT 0,
    gross_profit DECIMAL(15,2) DEFAULT 0,
    opex DECIMAL(15,2) DEFAULT 0,
    net_profit DECIMAL(15,2) DEFAULT 0,
    
    -- For audit trail - when was this captured
    snapshot_date DATE NOT NULL,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    job_status VARCHAR(20) DEFAULT 'success',
    error_message TEXT,
    
    -- Index for fast lookups
    UNIQUE(period_month, org, snapshot_date)
);

-- Table 3: Job run log (for debugging)
CREATE TABLE IF NOT EXISTS snapshot_job_log (
    id SERIAL PRIMARY KEY,
    run_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    job_type VARCHAR(50) NOT NULL,  -- 'daily', 'monthly', 'manual'
    orgs_processed INTEGER DEFAULT 0,
    orgs_failed INTEGER DEFAULT 0,
    duration_seconds INTEGER,
    status VARCHAR(20) DEFAULT 'running',
    error_summary TEXT,
    triggered_by VARCHAR(50) DEFAULT 'scheduled'  -- 'scheduled', 'manual'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_org ON daily_metrics(org);
CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_month ON monthly_snapshots(period_month DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_org ON monthly_snapshots(org);

-- =====================================================
-- USEFUL QUERIES FOR DEBUGGING
-- =====================================================

-- Check latest daily snapshot per org
-- SELECT org, MAX(snapshot_date) as latest FROM daily_metrics GROUP BY org;

-- Check if data changed between days
-- SELECT snapshot_date, org, cash_position, receivables_total 
-- FROM daily_metrics 
-- WHERE org = 'Mining' 
-- ORDER BY snapshot_date DESC LIMIT 10;

-- Check monthly P&L trend
-- SELECT period_month, revenue, net_profit 
-- FROM monthly_snapshots 
-- WHERE org = 'Mining' AND snapshot_date = (SELECT MAX(snapshot_date) FROM monthly_snapshots WHERE org = 'Mining')
-- ORDER BY period_month;

-- View job history
-- SELECT * FROM snapshot_job_log ORDER BY run_date DESC LIMIT 20;


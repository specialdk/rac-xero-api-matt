select * from daily_metrics;
select * from monthly_snapshots;
select * from snapshot_job_log;'

-- See all records captured today
SELECT snapshot_date, org, cash_position, receivables_total, total_assets, job_status
FROM daily_metrics
ORDER BY org;

-- See snapshot job history
SELECT id, run_date, job_type, orgs_processed, orgs_failed, duration_seconds, status, error_summary
FROM snapshot_job_log
ORDER BY run_date DESC;
# Background Job Observability

This document covers the dedicated observability metrics for scheduled background jobs in the NeuroWealth Backend.

## Metrics Reference

### `job_success_total{job_name}`

- **Type:** Counter
- **Description:** Increments once each time a background job completes without throwing an error.
- **When it increments:** On the successful path of each job function, after the database operation returns.

### `job_failure_total{job_name}`

- **Type:** Counter
- **Description:** Increments once each time a background job throws an unhandled error.
- **When it increments:** Inside the `catch` block of each job function, when the database operation or any downstream call fails.

### `job_duration_ms{job_name}`

- **Type:** Histogram
- **Description:** Observed duration of each job run, measured in milliseconds from start to finish (including any DB call latency).
- **Buckets (ms):** 100, 500, 1000, 2000, 5000, 10000, 30000, 60000
- **Normal range:** Most retention jobs complete in < 1000 ms under normal load. Spikes above 5000 ms indicate slow DB queries.

## Job Names

| `job_name` label | Description |
|---|---|
| `retention_auth_nonces` | Deletes expired rows from `auth_nonces` |
| `retention_processed_events` | Prunes `processed_events` older than the configured retention window |
| `retention_dead_letter_events` | Removes RESOLVED `dead_letter_events` older than the configured retention window |
| `retention_agent_logs` | Prunes `agent_logs` older than the configured retention window |
| `session_cleanup` | Deletes expired rows from `sessions` |

## Accessing Metrics

The `/metrics` endpoint is internal and requires a valid bearer token:

```
GET /metrics
Authorization: Bearer <METRICS_TOKEN>
```

Set `METRICS_TOKEN` in the environment. Prometheus should be configured to pass this header when scraping.

## Dashboard Panels (Grafana PromQL Examples)

```promql
# Success rate per job (last 1h)
rate(job_success_total[1h])

# Failure rate per job (last 1h)
rate(job_failure_total[1h])

# P95 job duration
histogram_quantile(0.95, rate(job_duration_ms_bucket[1h]))

# Jobs that have failed in the last 24h
increase(job_failure_total[24h]) > 0
```

## Alert Suggestions

```yaml
# Alert: job failing repeatedly
- alert: BackgroundJobFailing
  expr: increase(job_failure_total[1h]) > 3
  for: 0m
  labels:
    severity: warning
  annotations:
    summary: "Background job {{ $labels.job_name }} failing"
    description: "Job {{ $labels.job_name }} has failed more than 3 times in the last hour."

# Alert: job taking too long
- alert: BackgroundJobSlow
  expr: histogram_quantile(0.95, rate(job_duration_ms_bucket[1h])) > 30000
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Background job {{ $labels.job_name }} is slow (p95 > 30s)"
```

## Troubleshooting

- **Job not appearing in metrics:** The job has not yet run since the last process start. Metrics are emitted lazily on first execution. Check that the job is scheduled (look for the scheduler startup log line).
- **All jobs failing:** Most likely a database connectivity issue. Check DB connection pool health and `db_connections_active` metric.
- **Duration spike on a specific job:** Run `EXPLAIN ANALYZE` on the DELETE query for the affected table. Check for missing indexes on `expiresAt`, `processedAt`, or `createdAt` columns.

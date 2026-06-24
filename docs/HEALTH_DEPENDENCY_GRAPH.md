# Health Endpoint Dependency Graph

Reference guide showing which downstream services each health check depends on. Use this during incident triage to quickly identify what subsystem is likely failing.

---

## Dependency Matrix

| Endpoint | Response | Dependencies | Probe Type | Error Domain |
|----------|----------|--------------|-----------|--------------|
| `GET /health` | HTTP 200 always | None | Shallow | N/A — always succeeds |
| `GET /health/live` | HTTP 200 always | None | Shallow | N/A — always succeeds |
| `GET /health/ready` | HTTP 200 ✓ / 503 ✗ | PostgreSQL, Stellar RPC, Node scheduler | Deep | Database, event ingestion, agent loop |

---

## Detailed Dependency Graph

```
┌──────────────────────────────────────────────────────────────┐
│                  GET /health/ready                            │
│  (Returns 200 if ALL subsystems true, 503 if ANY false)      │
└───────┬──────────────────────┬──────────────────────┬─────────┘
        │                      │                      │
        ▼                      ▼                      ▼
   ┌──────────┐         ┌─────────────────┐      ┌──────────┐
   │ Database │         │ Event Listener  │      │AgentLoop │
   │ Subsystem│         │   Subsystem     │      │Subsystem │
   └────┬─────┘         └────────┬────────┘      └────┬─────┘
        │                        │                    │
        ▼                        ▼                    ▼
   PostgreSQL              Stellar RPC           Node.js
   Migrations              Event Stream       Scheduler/cron
   Connection Pool         Soroban RPC          Task Queue
        │                        │                    │
        └────────────────────────┴────────────────────┘
               All connections required
```

---

## Subsystem 1: Database (`database: true/false`)

### What it checks
- PostgreSQL connectivity
- Prisma ORM initialization
- Schema migrations applied
- Connection pool established

### Dependencies
```
Database Subsystem
└── PostgreSQL Server
    ├── TCP connectivity (host:port)
    ├── Authentication (DATABASE_URL credentials)
    ├── Database exists and accessible
    └── Prisma migrations complete
        └── Schema version up-to-date
```

### When it fails
- PostgreSQL is down or unreachable
- Connection credentials wrong or expired
- Network path to DB blocked (firewall, VPC, security group)
- Prisma migration failed or incomplete
- Connection pool exhausted
- Database locked (long-running transaction)

### How to debug
```bash
# 1. Check if database is reachable
psql "$DATABASE_URL" -c "SELECT 1"

# 2. Check Prisma migration status
npx prisma migrate status

# 3. Check connection pool
psql "$DATABASE_URL" -c "
  SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
"

# 4. Check logs for migration errors
tail -f logs/combined.log | grep -i "migration\|database\|prisma"

# 5. Verify DATABASE_URL is set
echo $DATABASE_URL | grep -q "postgresql" && echo "✓ Set" || echo "✗ Not set"
```

### Recovery steps
1. Verify PostgreSQL is running: `psql --version`
2. Restore network connectivity if needed
3. Run migrations: `npx prisma migrate deploy`
4. Restart application

### SLO
- Database health should be `true` within 30s of application startup
- Failures should trigger page within 1 minute

---

## Subsystem 2: Event Listener (`eventListener: true/false`)

### What it checks
- Stellar RPC connectivity
- Event ingestion loop running
- Cursor position tracked
- At least one event processed since startup

### Dependencies
```
Event Listener Subsystem
└── Stellar Soroban RPC
    ├── Network connectivity (HTTP/HTTPS)
    ├── RPC endpoint responding
    └── Ledger API available
        └── getLatestLedger, getEvents endpoints
```

### When it fails
- Stellar RPC endpoint is down or overloaded
- Network outage to Stellar
- Soroban contract events not available
- Event processing loop crashed or hung
- Event validation failing (all events rejected)
- RPC rate limits exceeded

### How to debug
```bash
# 1. Check RPC endpoint directly
curl -s -X POST "$STELLAR_RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq '.result.sequence'

# 2. Check event listener logs
tail -f logs/combined.log | grep -i "event\|listener\|rpc"

# 3. Check cursor position
psql "$DATABASE_URL" -c "SELECT * FROM event_cursors;"

# 4. Check if events were processed
psql "$DATABASE_URL" -c "
  SELECT COUNT(*) FROM processed_events 
  WHERE created_at > NOW() - INTERVAL '1 hour';
"

# 5. Check for DLQ backlog
psql "$DATABASE_URL" -c "
  SELECT status, COUNT(*) FROM dead_letter_events GROUP BY status;
"

# 6. Verify RPC URL is set and correct
echo $STELLAR_RPC_URL
```

### Recovery steps
1. Verify Stellar RPC endpoint is responding: `curl -X POST "$STELLAR_RPC_URL" ...`
2. If RPC is down, wait for recovery or switch to backup RPC (see RUNBOOK.md § RPC Failover)
3. Check event processing logs for validation errors
4. Restart event listener if hung: restart the pod
5. Verify `/health/ready` returns `eventListener: true`

### SLO
- Event listener should be `true` within 60s of startup
- Should process at least 1 event per minute in production
- Failures should trigger warning within 5 minutes

---

## Subsystem 3: Agent Loop (`agentLoop: true/false`)

### What it checks
- Rebalance check scheduler running
- Snapshot capture tasks scheduled
- Agent state persisted to DB
- Node.js cron jobs initialized

### Dependencies
```
Agent Loop Subsystem
└── Node.js Environment
    ├── Event loop running
    ├── setInterval/cron available
    ├── Database connection (to log agent actions)
    └── Agent configuration loaded
        └── Rebalance thresholds
        └── Protocol scanners
        └── APY calculator
```

### When it fails
- Node.js process hung or crashing
- Cron job failed to initialize
- Agent configuration invalid or missing
- Database connection lost (agent can't persist actions)
- Out of memory or CPU-bound operation
- Uncaught exception in agent loop

### How to debug
```bash
# 1. Check if node process is running
ps aux | grep "node.*dist/index.js"

# 2. Check agent logs
tail -f logs/combined.log | grep -i "agent\|rebalance\|snapshot"

# 3. Check agent loop status endpoint
curl http://localhost:3001/api/agent/status | jq '.status'

# 4. Check system resources
top -b -n 1 | head -20
# Look for: high CPU%, high memory%, or zombie processes

# 5. Check if DB connection lost
psql "$DATABASE_URL" -c "SELECT 1"

# 6. Verify agent config
grep -E "REBALANCE|AGENT" .env | head -10
```

### Recovery steps
1. Check Node.js process: `ps aux | grep node`
2. Check logs for uncaught errors: `tail -100 logs/error.log`
3. If hung: restart pod `kubectl delete pod <pod-name>`
4. Verify database connectivity is restored
5. Verify `/health/ready` returns `agentLoop: true`

### SLO
- Agent loop should be `true` within 45s of startup
- Should complete at least one rebalance check per hour
- Failures should trigger warning within 10 minutes

---

## Shallow vs Deep Probes

### Shallow Probes
- **Endpoints**: `GET /health`, `GET /health/live`
- **What they check**: HTTP server is responding
- **Latency**: <1ms
- **False positive rate**: Rare (only if entire container is dead)
- **Use for**: Container restart decision (K8s liveness probe)

### Deep Probes
- **Endpoints**: `GET /health/ready`
- **What they check**: All critical subsystems (DB, RPC, Agent)
- **Latency**: 10-100ms (depends on subsystem state)
- **False positive rate**: Can occur if subsystem temporarily slow
- **Use for**: Traffic routing decision (K8s readiness probe, load balancer)

---

## Incident Triage Flowchart

```
GET /health/ready returns 503
│
├─ Check response body
│  └─ Identify which subsystem is false
│
├─ database: false?
│  ├─ YES: Check PostgreSQL connectivity, migrations
│  └─ NO: Skip to next
│
├─ eventListener: false?
│  ├─ YES: Check Stellar RPC, event processing logs
│  └─ NO: Skip to next
│
└─ agentLoop: false?
   ├─ YES: Check Node.js process, scheduler logs
   └─ NO: All subsystems ready (unexpected error)
```

---

## Common Failure Scenarios

### Scenario 1: Database failover
```
Timeline:
1. Database connection drops (failover in progress)
   → database: false
   → GET /health/ready returns 503
2. K8s readiness probe fails
   → Traffic stops routing to this pod
3. Database recovers, connections reestablish
   → database: true (after connection retry)
   → GET /health/ready returns 200
   → Traffic resumes

Recovery time: 5-30 seconds (typical)
Alert: Warning if database: false > 1 minute
```

### Scenario 2: RPC endpoint degradation
```
Timeline:
1. Stellar RPC overloaded (response times spike)
   → Event processing slows
   → No new events processed for >5 min
   → eventListener: false
   → GET /health/ready returns 503
2. RPC recovers or failover completes
   → Event backlog cleared
   → eventListener: true
   → GET /health/ready returns 200

Recovery time: 2-10 minutes
Alert: Critical if eventListener: false > 5 minutes
```

### Scenario 3: Agent loop crash
```
Timeline:
1. Uncaught exception in rebalance check
   → Cron task fails silently
   → agentLoop: false
   → GET /health/ready returns 503
2. Alert fires, operator restarts pod
3. Agent loop reinitializes
   → agentLoop: true
   → GET /health/ready returns 200

Recovery time: <1 second (after restart)
Alert: Critical if agentLoop: false > 10 minutes
```

---

## Monitoring Queries

### Prometheus/Grafana

```promql
# Alert: Any subsystem down
(http_requests_total{path="/health/ready",status_code="503"}[1m] > 0)

# Alert: Persistent readiness failure
rate(http_requests_total{path="/health/ready",status_code="503"}[5m]) > 0.1

# Track time to readiness on startup
histogram_quantile(0.95, http_request_duration_seconds{path="/health/ready"})

# Combined app health (all probes passing)
(http_requests_total{path="/health",status_code="200"}[1m] > 0)
AND (http_requests_total{path="/health/live",status_code="200"}[1m] > 0)
AND (http_requests_total{path="/health/ready",status_code="200"}[1m] > 0)
```

### PostgreSQL

```sql
-- Check connection pool usage
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';

-- Check for long-running transactions (blocking)
SELECT pid, usename, application_name, state, query_start, state_change
FROM pg_stat_activity
WHERE state != 'idle'
  AND query_start < NOW() - INTERVAL '5 minutes';

-- Check migration status
SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;
```

### Application Logs

```bash
# Extract all critical health-related logs
grep -E "\[database\]|\[eventListener\]|\[agentLoop\]" logs/combined.log | tail -100

# Track subsystem state changes
grep -E "markReady|markNotReady" logs/combined.log | tail -20

# Watch for recovery patterns
grep "recovery\|reconnect\|retry" logs/combined.log | tail -20
```

---

## See Also

- [`docs/HEALTH_ENDPOINTS.md`](./HEALTH_ENDPOINTS.md) — Endpoint specifications and usage
- [`docs/RUNBOOK.md`](./RUNBOOK.md) — Operational procedures
- [`docs/OBSERVABILITY.md`](./OBSERVABILITY.md) — Metrics and alerting setup

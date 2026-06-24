# NeuroWealth — Production Deployment Runbook

End-to-end guide for deploying the NeuroWealth backend to Kubernetes with safe migrations, health checks, and secrets management.

For Docker image build details see also `docs/PRODUCTION_DEPLOYMENT.md`.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Kubernetes 1.25+ | Any managed cluster (EKS, GKE, AKS) |
| PostgreSQL 14+ | Managed database (RDS, Cloud SQL, etc.) — **not** the in-repo `docker-compose.yml` Postgres |
| Container registry | Push the image built from the root `Dockerfile` |
| Stellar Soroban RPC | `STELLAR_RPC_URL` or comma-separated `STELLAR_RPC_URLS` for failover |
| TLS certificate | cert-manager, cloud LB, or manual `Secret` for ingress |
| Secrets store | External Secrets Operator, Sealed Secrets, or `kubectl create secret` |

---

## Manifest layout

All manifests live under `deploy/k8s/`:

| File | Purpose |
|------|---------|
| `namespace.yaml` | `neurowealth` namespace |
| `configmap.yaml` | Non-secret environment (CORS, rate limits, RPC URLs, contract IDs) |
| `secret.yaml.example` | **Template only** — copy values into a real Secret; never commit plaintext |
| `serviceaccount.yaml` | Pod service account |
| `deployment.yaml` | App Deployment with initContainer migration + probes |
| `service.yaml` | ClusterIP on port 3001 |
| `ingress.yaml` | TLS termination (adjust host / ingress class) |
| `migration-job.yaml` | Standalone pre-deploy migration Job |
| `hpa.yaml` | HPA pinned to 1 replica (see scaling constraints) |

---

## Environment matrix

| Setting | Staging | Production |
|---------|---------|------------|
| `NODE_ENV` | `staging` | `production` |
| `STELLAR_NETWORK` | `testnet` | `mainnet` |
| `STELLAR_RPC_URL` | Testnet Soroban RPC | Mainnet Soroban RPC |
| `CORS_ORIGINS` | Staging frontend URL | Production frontend URL |
| `LOG_LEVEL` | `debug` | `info` |
| `replicas` | `1` | `1` (until worker split) |
| Secrets | Staging Secret / external store | Production Secret / external store |

Override `configmap.yaml` values per environment (separate ConfigMaps or Kustomize overlays recommended).

---

## Secrets

Create the live Secret from the template — **do not** apply `secret.yaml.example` with real values:

```bash
kubectl create namespace neurowealth

kubectl create secret generic neurowealth-secrets \
  --namespace=neurowealth \
  --from-literal=DATABASE_URL='postgresql://...' \
  --from-literal=JWT_SEED='...' \
  --from-literal=WALLET_ENCRYPTION_KEY='...' \
  --from-literal=STELLAR_AGENT_SECRET_KEY='...' \
  --from-literal=ANTHROPIC_API_KEY='...' \
  --from-literal=ADMIN_API_TOKEN='...' \
  --from-literal=TWILIO_AUTH_TOKEN='...'
```

Required keys match `src/config/env.ts` startup validation. Optional keys: `TWILIO_ACCOUNT_SID`, `INTERNAL_SERVICE_TOKEN`, `SLACK_WEBHOOK_URL`, `PAGERDUTY_ROUTING_KEY`.

---

## Build and push image

```bash
docker build -t <registry>/neurowealth-backend:<version> .
docker push <registry>/neurowealth-backend:<version>
```

Update the `image:` field in `deployment.yaml` and `migration-job.yaml` to your registry tag.

**Migration strategy:** The default `Dockerfile` CMD runs `prisma migrate deploy && node dist/index.js`. In Kubernetes, the Deployment **overrides** the command to `node dist/index.js` only. Migrations run in the **initContainer** (or standalone Job) so a failed migration blocks the rollout instead of leaving a half-started pod serving traffic.

---

## Rollout procedure

### 1. Migrate

**Option A — initContainer (default in `deployment.yaml`):** migrations run automatically before each pod starts.

**Option B — standalone Job (recommended for large migrations):**

```bash
# Update image tag in migration-job.yaml, then:
kubectl apply -f deploy/k8s/migration-job.yaml
kubectl wait --for=condition=complete job/neurowealth-migrate -n neurowealth --timeout=300s
```

### 2. Deploy

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/serviceaccount.yaml
kubectl apply -f deploy/k8s/configmap.yaml
# secrets already created above
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
kubectl apply -f deploy/k8s/ingress.yaml
```

### 3. Verify readiness

```bash
kubectl rollout status deployment/neurowealth-backend -n neurowealth

# Port-forward for local check:
kubectl port-forward svc/neurowealth-backend 3001:3001 -n neurowealth

curl -s http://localhost:3001/health/live
curl -s http://localhost:3001/health/ready
```

Readiness returns **200** only when database, event listener, and agent loop are all healthy. During rollout or shutdown it returns **503**.

### 4. Smoke test

```bash
curl -s -o /dev/null -w "%{http_code}" https://api.neurowealth.io/health
```

---

## Health probes

Configured in `deployment.yaml` to match existing endpoints in `src/index.ts`:

| Probe | Path | Purpose |
|-------|------|---------|
| Liveness | `GET /health/live` | Process is running — always 200 |
| Readiness | `GET /health/ready` | DB + event listener + agent loop ready |

`terminationGracePeriodSeconds: 35` — the app drains in-flight requests for up to 30 s on `SIGTERM` before stopping background services.

---

## Rollback procedure

```bash
# Roll back to previous ReplicaSet
kubectl rollout undo deployment/neurowealth-backend -n neurowealth

# Or pin a known-good image:
kubectl set image deployment/neurowealth-backend \
  api=<registry>/neurowealth-backend:<previous-version> \
  -n neurowealth

kubectl rollout status deployment/neurowealth-backend -n neurowealth
```

**Database rollback:** Prisma migrations are forward-only. If a migration introduced a breaking schema change, restore from a database backup or deploy a hotfix migration — do not rely on `migrate reset` in production.

---

## Scaling guidance

### Current constraint: single active consumer

The monolith starts three subsystems in every pod (`src/index.ts`):

1. HTTP API
2. **Stellar event listener** — polls Soroban RPC every 5 s, persists cursor to `event_cursors`
3. **Agent cron loop** — hourly rebalance, snapshots, daily protocol scan

There is **no leader election**. Running multiple replicas will:

- Duplicate event processing (mitigated by `processed_events` idempotency, but wastes RPC quota and risks race conditions)
- Run duplicate cron jobs (rebalance checks, snapshots)

**Recommendation:** keep `replicas: 1` until the architecture is split.

### Future scaling path

1. Add feature flags: `ENABLE_EVENT_LISTENER`, `ENABLE_AGENT_LOOP`
2. Split deployments:
   - `neurowealth-api` — stateless HTTP, `replicas: N`, HPA enabled
   - `neurowealth-worker` — listener + agent, `replicas: 1`
3. Optional: K8s Lease or Postgres advisory lock for worker leader election before scaling workers beyond 1

### HPA

`deploy/k8s/hpa.yaml` is pinned to `minReplicas: 1` / `maxReplicas: 1`. Re-enable scaling only after the worker/API split.

---

## Observability

- **Metrics:** `GET /metrics` on port 3001 (Prometheus)
- **Request tracing:** clients may send `X-Request-ID` or `X-Correlation-ID`; the server echoes `X-Request-ID` on every response and includes `correlationId` in structured logs
- **DLQ:** monitor `dead_letter_events` count and `event_cursors.lastProcessedLedger` lag — see `docs/OBSERVABILITY.md` and `docs/RUNBOOK.md`

### Monitoring assets

Pre-built alert rules and Grafana dashboards live under `deploy/monitoring/`:

| Path | Purpose |
|------|---------|
| `deploy/monitoring/prometheus/alert-rules.yaml` | Prometheus alert rules (critical + warning) |
| `deploy/monitoring/grafana/dashboards/system-overview.json` | System overview dashboard |
| `deploy/monitoring/grafana/dashboards/agent-loop.json` | Agent loop health dashboard |
| `deploy/monitoring/grafana/dashboards/dlq.json` | DLQ and cursor lag dashboard |
| `deploy/monitoring/grafana/dashboards/latency.json` | HTTP, DB, and event latency dashboard |
| `deploy/monitoring/grafana/provisioning/datasources.yaml` | Grafana datasource provisioning |
| `deploy/monitoring/grafana/provisioning/dashboards.yaml` | Grafana dashboard provisioning |

**Prometheus:** add the alert rules file to your Prometheus configuration:

```yaml
rule_files:
  - /etc/prometheus/rules/alert-rules.yaml
```

**Grafana:** copy the provisioning files and dashboards to your Grafana instance:

```bash
cp deploy/monitoring/grafana/provisioning/* /etc/grafana/provisioning/
cp deploy/monitoring/grafana/dashboards/*.json /etc/grafana/dashboards/
```

Grafana will auto-load the dashboards on next restart.

---

## CI validation

Manifests are validated in CI with `kubeconform` (see `.github/workflows/k8s-validate.yml`). Run locally:

```bash
kubeconform -summary deploy/k8s/*.yaml
```

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Pod `CrashLoopBackOff` | `kubectl logs deployment/neurowealth-backend -n neurowealth`; verify all required secrets |
| Readiness 503 | `kubectl logs` — DB connection, RPC URL, or background service startup failure |
| Migration initContainer failed | `kubectl logs <pod> -c migrate -n neurowealth` |
| Events not processing | `SELECT * FROM event_cursors;` — cursor lag; ensure only one replica runs the listener |
| Duplicate rebalances | Confirm `replicas: 1`; check agent cron is not running on multiple pods |

---

## Related docs

- `docs/PRODUCTION_DEPLOYMENT.md` — Docker build, secret rotation
- `docs/RUNBOOK.md` — DLQ replay, cursor management
- `docs/OBSERVABILITY.md` — alerting and metrics
- `readme.md` — API request tracing headers

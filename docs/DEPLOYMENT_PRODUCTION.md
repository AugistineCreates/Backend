# Production deployment guide

Concise runbook for building, deploying, and operating the NeuroWealth backend in production.

## Prerequisites

- Node.js 20 (matches `Dockerfile` and CI)
- PostgreSQL 14+
- A secrets store (AWS Secrets Manager, HashiCorp Vault, GitHub Actions secrets, etc.)
- TLS termination at your load balancer or ingress

---

## Build

### Docker image (recommended)

Multi-stage build compiles TypeScript, generates the Prisma client, and produces a slim runtime image running as non-root user `app`.

```bash
# From repository root
docker build -t neurowealth-backend:latest .

# Tag and push to your registry
docker tag neurowealth-backend:latest <registry>/neurowealth-backend:<version>
docker push <registry>/neurowealth-backend:<version>
```

The image CMD runs `prisma migrate deploy && node dist/index.js`. For Kubernetes, prefer running migrations in an **initContainer** so rollouts stay atomic and failed migrations do not leave a half-started pod serving traffic.

### Bare-metal / VM build

```bash
npm ci
npx prisma generate
npm run build
```

Start with:

```bash
npx prisma migrate deploy
node dist/index.js
```

Or use the safe migration script (applies migrations then runs smoke test):

```bash
DATABASE_URL=postgresql://... bash scripts/apply-migration.sh
```

---

## Deploy

### Docker Compose (Postgres only)

`docker-compose.yml` runs Postgres for local development. In production, use a managed database (RDS, Cloud SQL, etc.) and run the app container separately:

```bash
docker run -d \
  --name neurowealth-backend \
  -p 3001:3001 \
  --env-file /path/to/production.env \
  <registry>/neurowealth-backend:<version>
```

### Kubernetes (outline)

1. **Secrets** — mount required env vars via `Secret` + `envFrom` or an external secrets operator.
2. **initContainer** — run `npx prisma migrate deploy` against `DATABASE_URL` before the main container starts.
3. **Probes** — configure liveness and readiness (see [Health probes](#health-probes)).
4. **Ingress** — terminate TLS at ingress; the app sets `trust proxy` to `1` (one reverse-proxy hop) in `src/index.ts`.
5. **Graceful shutdown** — allow at least 30 s `terminationGracePeriodSeconds`; the app drains in-flight requests on `SIGTERM`.

Example initContainer:

```yaml
initContainers:
  - name: migrate
    image: <registry>/neurowealth-backend:<version>
    command: ["npx", "prisma", "migrate", "deploy"]
    envFrom:
      - secretRef:
          name: neurowealth-backend-secrets
```

Override the main container command to skip inline migration when using an initContainer:

```yaml
command: ["node", "dist/index.js"]
```

### Startup behaviour

The HTTP server **does not accept traffic** until all critical services initialise:

1. Database connection
2. Stellar event listener
3. Agent loop

If any step fails, the process exits with a non-zero code so your orchestrator restarts the pod.

---

## Environment variables

Copy `.env.example` as a checklist. Set every value via your secrets manager — never commit production secrets.

### Required (app will not start without these)

| Variable | Notes |
|----------|-------|
| `NODE_ENV` | Must be `production` |
| `PORT` | Default `3001` |
| `DATABASE_URL` | PostgreSQL connection string |
| `STELLAR_NETWORK` | `mainnet`, `testnet`, or `futurenet` |
| `STELLAR_RPC_URL` | Soroban RPC endpoint for the chosen network |
| `STELLAR_AGENT_SECRET_KEY` | 56-char Stellar secret (`S…`) |
| `VAULT_CONTRACT_ID` | Deployed vault contract ID |
| `USDC_TOKEN_ADDRESS` | USDC token contract on Stellar |
| `ANTHROPIC_API_KEY` | Claude API key for the agent |
| `JWT_SEED` | 64-hex secret for signing sessions — rotate every 90 days |
| `WALLET_ENCRYPTION_KEY` | 64-hex (32 bytes) — `openssl rand -hex 32` |
| `TWILIO_AUTH_TOKEN` | Required for WhatsApp webhook signature validation |

### Required in production only

| Variable | Notes |
|----------|-------|
| `ADMIN_API_TOKEN` | Strong token (≥ 8 chars) for `/api/admin/*` — inject via secrets manager |
| `CORS_ORIGINS` or `ALLOWED_ORIGINS` | Comma-separated frontend origins (e.g. `https://app.example.com`) — **do not use `*`** |

### Recommended

| Variable | Default | Notes |
|----------|---------|-------|
| `LOG_LEVEL` | `info` | Winston log level in production |
| `RATE_LIMIT_*` / `AUTH_RATE_LIMIT_*` | see `.env.example` | Tune per environment |
| `INTERNAL_SERVICE_TOKEN` | — | Service-to-service bypass for rate limits |
| `TRUSTED_IPS` | — | Comma-separated IPs that skip rate limits (probes, internal scrapers) |
| `DLQ_ALERT_THRESHOLD` | `50` | Alert when dead-letter queue exceeds this count |

**Reverse proxy:** Express `trust proxy` is set to `1` in `src/index.ts` so `req.ip` reflects the client behind a single load balancer. If you run behind CDN + LB (two hops), adjust that setting before deploy.

Full list and defaults: `.env.example`.

---

## Health probes

| Probe | Path | Success | Failure | Use |
|-------|------|---------|---------|-----|
| **Liveness** | `GET /health/live` | `200` | n/a | Process is running; restart if unreachable |
| **Readiness** | `GET /health/ready` | `200` when DB, event listener, and agent loop are ready | `503` during startup or shutdown | Route traffic only to healthy instances |

Additional endpoints:

- `GET /health` — basic JSON status (also available via `healthRouter`)
- `GET /health/ready` (router) — subsystem readiness via `getReadiness()`
- `GET /metrics` — Prometheus scrape target

### Kubernetes example

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 15
  timeoutSeconds: 5

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3001
  initialDelaySeconds: 15
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

### AWS ALB example

- **Health check path:** `/health/ready`
- **Matcher:** `200`
- **Interval:** 30 s
- **Unhealthy threshold:** 3

During graceful shutdown (`SIGTERM`/`SIGINT`), readiness returns `503` with `status: shutting_down` so load balancers stop sending new requests before the process exits.

---

## Secrets guidance

| Secret | Rotation | Notes |
|--------|----------|-------|
| `JWT_SEED` | Every 90 days | Invalidates active sessions; schedule maintenance window |
| `WALLET_ENCRYPTION_KEY` | Coordinated migration | Re-encrypt `custodial_wallets` rows before swapping the key; loss of key = unrecoverable wallets |
| `STELLAR_AGENT_SECRET_KEY` | Rare | Fund a new agent key and update contract permissions before swap |
| `ADMIN_API_TOKEN` | On compromise | Rotate immediately; update secrets store and redeploy |
| `TWILIO_AUTH_TOKEN` | On compromise | Update Twilio console and redeploy |
| `DATABASE_URL` | Per provider policy | Use least-privilege DB user; enable SSL |

**Do:**

- Inject secrets at runtime from a secrets manager
- Use separate credentials per environment (staging vs production)
- Take a DB snapshot before running `prisma migrate deploy`

**Do not:**

- Commit `.env` files or bake secrets into Docker image layers
- Log secret values (Winston redacts in production but avoid passing secrets in error messages)

---

## Runbook — troubleshooting commands

### Health and readiness

```bash
# Liveness — should always return 200 once the process is up
curl -sS http://localhost:3001/health/live | jq .

# Readiness — 200 when all subsystems ready, 503 during startup/shutdown
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3001/health/ready

# Detailed subsystem status
curl -sS http://localhost:3001/health/ready | jq .
```

### Database and migrations

```bash
# Check migration status
DATABASE_URL="postgresql://..." npx prisma migrate status

# Apply pending migrations (production-safe, non-destructive)
DATABASE_URL="postgresql://..." npx prisma migrate deploy

# Safe migration + smoke test
DATABASE_URL="postgresql://..." bash scripts/apply-migration.sh

# Verify DB connectivity from the app host
psql "$DATABASE_URL" -c "SELECT 1"
```

### Logs and metrics

```bash
# Docker logs
docker logs neurowealth-backend --tail 200 -f

# Kubernetes logs
kubectl logs -l app=neurowealth-backend --tail=200 -f

# Prometheus metrics
curl -sS http://localhost:3001/metrics | head -50
```

### Common startup failures

```bash
# Missing or invalid env — app prints all validation errors at once
NODE_ENV=production node dist/index.js

# Verify required production vars are set (no values printed)
env | grep -E '^(NODE_ENV|DATABASE_URL|ADMIN_API_TOKEN|CORS_ORIGINS|JWT_SEED|WALLET_ENCRYPTION_KEY)='

# Stellar network mismatch warning
# Ensure STELLAR_NETWORK=mainnet only when NODE_ENV=production and keys are mainnet
```

### Rollback

1. Scale down or stop new pods/tasks.
2. Restore database from pre-migration snapshot if the migration was destructive.
3. Redeploy the previous image tag.
4. Confirm `/health/ready` returns `200` and monitor logs for 15 minutes.

### Rate-limit / proxy issues

```bash
# The app trusts one reverse-proxy hop (trust proxy = 1).
# If client IPs look wrong behind CDN + LB, update src/index.ts before redeploying.
curl -H "X-Forwarded-For: 203.0.113.1" http://localhost:3001/health/live
```

---

## Related docs

- `.env.example` — full environment variable reference
- `readme.md` — local development, auth flow, rate limiting
- `Dockerfile` — image build stages and default CMD
- `scripts/apply-migration.sh` — CI/CD migration gate with smoke test

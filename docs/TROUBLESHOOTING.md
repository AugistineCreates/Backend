# Local Development Troubleshooting Guide

This guide covers common issues encountered when setting up and running the NeuroWealth backend locally, with symptoms, root causes, and fix steps.

## Table of Contents

- [Environment Variables](#environment-variables)
- [Database Connectivity](#database-connectivity)
- [Prisma Schema Issues](#prisma-schema-issues)
- [Health Check Failures](#health-check-failures)
- [Stellar Network Issues](#stellar-network-issues)
- [Build and Runtime Errors](#build-and-runtime-errors)
- [Test Failures](#test-failures)

---

## Environment Variables

### Symptom: Application fails to start with "Missing required environment variable"

**Error Message**:
```
Application cannot start — environment configuration errors:
  - Missing required environment variable: STELLAR_NETWORK
  - Missing required environment variable: DATABASE_URL
  ...
```

**Root Cause**: Required environment variables are not set in `.env` file or shell environment.

**Fix Steps**:
1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in all required variables:
   ```bash
   # Required variables
   STELLAR_NETWORK=testnet
   STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   STELLAR_AGENT_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   VAULT_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   USDC_TOKEN_ADDRESS=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   DATABASE_URL=postgresql://postgres:password@localhost:5432/neurowealth
   JWT_SEED=your_jwt_secret_seed_here_minimum_32_characters
   WALLET_ENCRYPTION_KEY=generate_with_openssl_rand_hex_32
   TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
   NODE_ENV=development
   ```

3. Generate secure values where needed:
   ```bash
   # Generate wallet encryption key (64 hex chars)
   openssl rand -hex 32

   # Generate JWT seed (48 base64 chars)
   openssl rand -base64 48
   ```

4. Restart the application:
   ```bash
   npm run dev
   ```

---

### Symptom: "WALLET_ENCRYPTION_KEY is invalid"

**Error Message**:
```
WALLET_ENCRYPTION_KEY is invalid: must be exactly 64 hexadecimal characters (32 bytes).
Got length 32. Generate one with: openssl rand -hex 32
```

**Root Cause**: Wallet encryption key is not 64 hexadecimal characters.

**Fix Steps**:
1. Generate a valid key:
   ```bash
   openssl rand -hex 32
   ```

2. Update `.env` with the generated value:
   ```bash
   WALLET_ENCRYPTION_KEY=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
   ```

3. Restart the application.

---

### Symptom: "JWT_SEED is too weak"

**Error Message**:
```
JWT_SEED is too weak: must be at least 32 characters.
Got length 16. Use a strong random string or generate with: openssl rand -base64 48
```

**Root Cause**: JWT seed is too short for cryptographic security.

**Fix Steps**:
1. Generate a strong seed:
   ```bash
   openssl rand -base64 48
   ```

2. Update `.env` with the generated value (minimum 32 characters).

3. Restart the application.

---

### Symptom: "ANTHROPIC_API_KEY is invalid"

**Error Message**:
```
ANTHROPIC_API_KEY is invalid: must start with "sk-ant-".
Got prefix "sk-proj-". Get your key from: https://console.anthropic.com/
```

**Root Cause**: Invalid Anthropic API key format.

**Fix Steps**:
1. Get a valid API key from https://console.anthropic.com/
2. Ensure the key starts with `sk-ant-`
3. Update `.env` with the correct key.

---

### Symptom: "DATABASE_URL is invalid"

**Error Message**:
```
DATABASE_URL is invalid: must start with "postgresql://" or "postgres://".
Got: "mysql://user:pass@localhost:3306/dbname". Example: postgresql://user:pass@localhost:5432/dbname
```

**Root Cause**: Invalid database connection string format.

**Fix Steps**:
1. Ensure you're using PostgreSQL (not MySQL)
2. Use the correct format:
   ```bash
   DATABASE_URL=postgresql://user:password@localhost:5432/dbname
   ```
3. If using Docker Compose, use the service name as host:
   ```bash
   DATABASE_URL=postgresql://postgres:password@neurowealth_db:5432/postgres
   ```

---

## Database Connectivity

### Symptom: "Connection refused" or"ECONNREFUSED"

**Error Message**:
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Root Cause**: PostgreSQL is not running or not accessible.

**Fix Steps**:

**Option A: Using Docker Compose**
1. Start the database:
   ```bash
   docker-compose up -d
   ```

2. Verify it's running:
   ```bash
   docker-compose ps
   ```

3. Check logs:
   ```bash
   docker-compose logs db
   ```

**Option B: Using Local PostgreSQL**
1. Ensure PostgreSQL is installed and running:
   ```bash
   # macOS
   brew services start postgresql

   # Linux
   sudo systemctl start postgresql

   # Windows
   # Start PostgreSQL Service from Services
   ```

2. Verify connection:
   ```bash
   psql -U postgres -d neurowealth
   ```

3. Create database if it doesn't exist:
   ```bash
   psql -U postgres -c "CREATE DATABASE neurowealth;"
   ```

---

### Symptom: "authentication failed" or "password authentication failed"

**Error Message**:
```
Error: password authentication failed for user "postgres"
```

**Root Cause**: Incorrect database credentials in `DATABASE_URL`.

**Fix Steps**:
1. Verify your PostgreSQL credentials:
   ```bash
   psql -U postgres -d neurowealth
   ```

2. Update `.env` with correct credentials:
   ```bash
   DATABASE_URL=postgresql://postgres:CORRECT_PASSWORD@localhost:5432/neurowealth
   ```

3. If using Docker Compose, check `docker-compose.yml` for the correct password:
   ```bash
   grep POSTGRES_PASSWORD docker-compose.yml
   ```

---

### Symptom: "database does not exist"

**Error Message**:
```
Error: database "neurowealth" does not exist
```

**Root Cause**: Database hasn't been created.

**Fix Steps**:
1. Create the database:
   ```bash
   psql -U postgres -c "CREATE DATABASE neurowealth;"
   ```

2. Or use Docker Compose (creates database automatically):
   ```bash
   docker-compose up -d
   ```

---

## Prisma Schema Issues

### Symptom: "Schema mismatch" or migration errors

**Error Message**:
```
Error: P3006
Migration `20260326152030_add_event_tracking` failed to apply cleanly to the shadow database.
```

**Root Cause**: Prisma schema is out of sync with the database.

**Fix Steps**:
1. Generate Prisma client:
   ```bash
   npx prisma generate
   ```

2. Check migration status:
   ```bash
   npx prisma migrate status
   ```

3. Apply pending migrations:
   ```bash
   npx prisma migrate deploy
   ```

4. If migrations fail, reset (WARNING: destroys data):
   ```bash
   npx prisma migrate reset
   ```

---

### Symptom: "P3001 Migration did not apply cleanly"

**Error Message**:
```
Error: P3001
Migration did not apply cleanly
```

**Root Cause**: Migration conflicts or manual schema changes.

**Fix Steps**:
1. Resolve the specific migration issue by checking the migration SQL:
   ```bash
   cat prisma/migrations/*/migration.sql
   ```

2. If the migration was already applied manually, mark it as applied:
   ```bash
   npx prisma migrate resolve --applied "migration_name"
   ```

3. If the migration needs to be rolled back:
   ```bash
   npx prisma migrate resolve --rolled-back "migration_name"
   ```

4. Re-run migrations:
   ```bash
   npx prisma migrate deploy
   ```

---

### Symptom: TypeScript errors with Prisma types

**Error Message**:
```
error TS2339: Property 'id' does not exist on type 'User'
```

**Root Cause**: Prisma client not generated after schema changes.

**Fix Steps**:
1. Regenerate Prisma client:
   ```bash
   npx prisma generate
   ```

2. If that fails, clean and regenerate:
   ```bash
   rm -rf node_modules/.prisma
   npx prisma generate
   ```

3. Restart TypeScript server in your IDE (Cmd+Shift+P → "TypeScript: Restart TS Server")

---

## Health Check Failures

### Symptom: `/health/ready` returns 503

**Error Message**:
```json
{
  "status": "not_ready",
  "services": {
    "database": { "ready": false, "error": "Connection refused" },
    "eventListener": { "ready": true },
    "agentLoop": { "ready": true }
  }
}
```

**Root Cause**: One or more critical services failed to initialize.

**Fix Steps**:
1. Check which service is failing:
   ```bash
   curl http://localhost:3001/health/ready
   ```

2. Check application logs for the specific error:
   ```bash
   # If using file logging
   tail -f logs/combined.log

   # If using console output
   npm run dev
   ```

3. Common fixes by service:
   - **database**: Fix `DATABASE_URL`, ensure PostgreSQL is running
   - **eventListener**: Check `STELLAR_RPC_URL` connectivity
   - **agentLoop**: Check Stellar agent key and contract ID

---

### Symptom: `/health/live` returns 503 or timeout

**Root Cause**: Application is not running or crashed.

**Fix Steps**:
1. Check if the process is running:
   ```bash
   ps aux | grep node
   ```

2. Check if the port is in use:
   ```bash
   lsof -i :3001
   ```

3. Kill any existing process on port 3001:
   ```bash
   kill -9 $(lsof -t -i:3001)
   ```

4. Restart the application:
   ```bash
   npm run dev
   ```

---

## Stellar Network Issues

### Symptom: "Invalid Stellar secret key format"

**Error Message**:
```
STELLAR_AGENT_SECRET_KEY must start with S (invalid Stellar secret key format)
```

**Root Cause**: Invalid Stellar secret key format.

**Fix Steps**:
1. Generate a valid Stellar keypair using Stellar SDK:
   ```bash
   # Using stellar-cli
   stellar keys generate my-key

   # Or use the SDK
   npx ts-node -e "import { Keypair } from '@stellar/stellar-sdk'; const kp = Keypair.random(); console.log('Secret:', kp.secret()); console.log('Public:', kp.publicKey());"
   ```

2. Update `.env` with the generated secret key (starts with 'S', 56 characters).

3. Ensure the key has sufficient XLM balance on the target network.

---

### Symptom: RPC connection timeout

**Error Message**:
```
Error: fetch failed - timeout connecting to https://soroban-testnet.stellar.org
```

**Root Cause**: Network connectivity issues or RPC server down.

**Fix Steps**:
1. Test RPC connectivity:
   ```bash
   curl -X POST https://soroban-testnet.stellar.org \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}'
   ```

2. If RPC is down, use an alternative:
   ```bash
   # Testnet alternatives
   STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   STELLAR_RPC_URL=https://testnet.rpc.sorobanrpc.com
   ```

3. Check your internet connection and firewall settings.

---

### Symptom: "Invalid contract ID" errors

**Error Message**:
```
Error: Invalid contract ID format
```

**Root Cause**: Contract ID doesn't match Stellar contract ID format.

**Fix Steps**:
1. Ensure contract ID starts with 'C' and is 56 alphanumeric characters:
   ```bash
   VAULT_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

2. Verify the contract ID matches your deployed contract on the target network.

3. Check network alignment (testnet vs mainnet):
   ```bash
   STELLAR_NETWORK=testnet  # or mainnet
   ```

---

## Build and Runtime Errors

### Symptom: TypeScript compilation errors

**Error Message**:
```
error TS2307: Cannot find module './config' or its corresponding type declarations
```

**Root Cause**: Missing dependencies or incorrect import paths.

**Fix Steps**:
1. Install dependencies:
   ```bash
   npm install
   ```

2. Clean and rebuild:
   ```bash
   rm -rf dist node_modules
   npm install
   npm run build
   ```

3. Check TypeScript configuration:
   ```bash
   npx tsc --noEmit
   ```

---

### Symptom: "Module not found" errors

**Error Message**:
```
Error: Cannot find module '@prisma/client'
```

**Root Cause**: Prisma client not generated.

**Fix Steps**:
1. Generate Prisma client:
   ```bash
   npx prisma generate
   ```

2. Reinstall dependencies:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

---

### Symptom: Port already in use

**Error Message**:
```
Error: listen EADDRINUSE: address already in use :::3001
```

**Root Cause**: Another process is using port 3001.

**Fix Steps**:
1. Find and kill the process:
   ```bash
   # Find process
   lsof -i :3001

   # Kill it
   kill -9 $(lsof -t -i:3001)
   ```

2. Or use a different port:
   ```bash
   PORT=3002 npm run dev
   ```

---

## Test Failures

### Symptom: Tests fail with database connection errors

**Error Message**:
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Root Cause**: Test database not running or misconfigured.

**Fix Steps**:
1. Ensure test database is running (Docker Compose):
   ```bash
   docker-compose up -d
   ```

2. Set test environment variables:
   ```bash
   export NODE_ENV=test
   export DATABASE_URL=postgresql://postgres:password@localhost:5432/neurowealth_test
   ```

3. Run migrations on test database:
   ```bash
   npx prisma migrate deploy
   ```

---

### Symptom: Tests timeout or hang

**Root Cause**: Tests waiting for async operations or external services.

**Fix Steps**:
1. Check for missing async/await in tests
2. Mock external service calls (Stellar RPC, Anthropic API)
3. Increase test timeout in jest config:
   ```bash
   # Add to package.json jest config
   "testTimeout": 10000
   ```

---

### Symptom: "Cannot find module" in tests

**Error Message**:
```
Error: Cannot find module '../src/config/env'
```

**Root Cause**: Incorrect import paths in test files.

**Fix Steps**:
1. Use correct relative paths from `tests/` directory
2. Or configure TypeScript path mapping in `tsconfig.json`
3. Ensure source files are compiled before running tests:
   ```bash
   npm run build
   npm test
   ```

---

## Getting Help

If you've tried the above steps and still can't resolve the issue:

1. **Check the logs**:
   ```bash
   tail -f logs/combined.log
   tail -f logs/error.log
   ```

2. **Verify your environment**:
   ```bash
   node --version  # Should be 20+
   npm --version   # Should be 10+
   psql --version  # Should be 14+
   ```

3. **Search existing issues**: Check GitHub Issues for similar problems

4. **Create a detailed bug report** including:
   - Error message (full stack trace)
   - Environment (OS, Node version, PostgreSQL version)
   - Steps to reproduce
   - What you've already tried

---

## Quick Reference Commands

```bash
# Environment setup
cp .env.example .env
openssl rand -hex 32  # Generate wallet encryption key
openssl rand -base64 48  # Generate JWT seed

# Database operations
docker-compose up -d  # Start database
npx prisma generate  # Generate Prisma client
npx prisma migrate deploy  # Apply migrations
npx prisma migrate status  # Check migration status
npx prisma migrate reset  # Reset database (WARNING: destroys data)

# Health checks
curl http://localhost:3001/health/live
curl http://localhost:3001/health/ready

# Build and run
npm install
npm run build
npm run dev

# Tests
npm test
npm run test:unit
npm run test:integration
```

/**
 * Jest global setup — runs before any test module is imported.
 * Provides all required env vars so src/config/env.ts validation passes
 * in every test suite that imports the app (integration tests, etc.).
 *
 * Unit tests that exercise env validation directly (tests/unit/config/env.test.ts)
 * call jest.resetModules() and manage their own env, so this doesn't interfere.
 */

// Valid 64-char hex key (32 bytes) — safe dummy value for tests only
process.env.WALLET_ENCRYPTION_KEY =
  process.env.WALLET_ENCRYPTION_KEY ??
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? 'testnet'
process.env.STELLAR_RPC_URL =
  process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org'
process.env.STELLAR_AGENT_SECRET_KEY =
  process.env.STELLAR_AGENT_SECRET_KEY ??
  'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
process.env.VAULT_CONTRACT_ID = process.env.VAULT_CONTRACT_ID ?? 'CVAULT_TEST'
process.env.USDC_TOKEN_ADDRESS = process.env.USDC_TOKEN_ADDRESS ?? 'CUSDC_TEST'
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-anthropic-key'
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/test_db'
process.env.JWT_SEED = process.env.JWT_SEED ?? 'test-jwt-seed-value'
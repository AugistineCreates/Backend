/**
 * Unit tests — Environment configuration validation
 */

// Valid test values
const VALID_WALLET_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' // 64 hex chars
const VALID_SECRET_KEY = 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' // 56 chars starting with S

/** Set a complete, valid environment so individual tests can delete/override one var at a time. */
function setValidEnv() {
  process.env.STELLAR_NETWORK = 'testnet'
  process.env.STELLAR_RPC_URL = 'https://rpc.example.com'
  process.env.STELLAR_AGENT_SECRET_KEY = VALID_SECRET_KEY
  process.env.VAULT_CONTRACT_ID = 'CVAULT'
  process.env.USDC_TOKEN_ADDRESS = 'CUSDC'
  process.env.ANTHROPIC_API_KEY = 'key'
  process.env.DATABASE_URL = 'postgresql://localhost/db'
  process.env.JWT_SEED = 'seed'
  process.env.WALLET_ENCRYPTION_KEY = VALID_WALLET_KEY
  process.env.NODE_ENV = 'test'
}

describe('Environment Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    jest.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('Required environment variables validation', () => {
    it('throws error when STELLAR_NETWORK is missing', () => {
      setValidEnv()
      delete process.env.STELLAR_NETWORK

      expect(() => {
        require('../../../src/config/env')
      }).toThrow(/Missing required environment variable: STELLAR_NETWORK/)
    })

    it('throws error when STELLAR_AGENT_SECRET_KEY is missing', () => {
      setValidEnv()
      delete process.env.STELLAR_AGENT_SECRET_KEY

      expect(() => {
        require('../../../src/config/env')
      }).toThrow(/Missing required environment variable: STELLAR_AGENT_SECRET_KEY/)
    })

    it('throws error when VAULT_CONTRACT_ID is missing', () => {
      setValidEnv()
      delete process.env.VAULT_CONTRACT_ID

      expect(() => {
        require('../../../src/config/env')
      }).toThrow(/Missing required environment variable: VAULT_CONTRACT_ID/)
    })

    it('throws error when DATABASE_URL is missing', () => {
      setValidEnv()
      delete process.env.DATABASE_URL

      expect(() => {
        require('../../../src/config/env')
      }).toThrow(/Missing required environment variable: DATABASE_URL/)
    })

    it('throws error when WALLET_ENCRYPTION_KEY is missing', () => {
      setValidEnv()
      delete process.env.WALLET_ENCRYPTION_KEY

      expect(() => {
        require('../../../src/config/env')
      }).toThrow(/Missing required environment variable: WALLET_ENCRYPTION_KEY/)
    })

    it('throws error when WALLET_ENCRYPTION_KEY is not 64 hex chars', () => {
      setValidEnv()
      process.env.WALLET_ENCRYPTION_KEY = 'tooshort'

      expect(() => {
        require('../../../src/config/env')
      }).toThrow(/WALLET_ENCRYPTION_KEY is invalid/)
    })
  })

  describe('Stellar network validation', () => {
    it('accepts valid network: testnet', () => {
      setValidEnv()

      const config = require('../../../src/config/env').config
      expect(config.stellar.network).toBe('testnet')
    })

    it('accepts valid network: mainnet', () => {
      setValidEnv()
      process.env.STELLAR_NETWORK = 'mainnet'
      process.env.NODE_ENV = 'production'

      const config = require('../../../src/config/env').config
      expect(config.stellar.network).toBe('mainnet')
    })

    it('accepts valid network: futurenet', () => {
      setValidEnv()
      process.env.STELLAR_NETWORK = 'futurenet'

      const config = require('../../../src/config/env').config
      expect(config.stellar.network).toBe('futurenet')
    })

    it('rejects invalid network', () => {
      setValidEnv()
      process.env.STELLAR_NETWORK = 'invalidnet'

      expect(() => {
        require('../../../src/config/env')
      }).toThrow(/Invalid STELLAR_NETWORK/)
    })

    it('is case-insensitive', () => {
      setValidEnv()
      process.env.STELLAR_NETWORK = 'TESTNET'

      const config = require('../../../src/config/env').config
      expect(config.stellar.network).toBe('testnet')
    })
  })

  describe('Stellar secret key validation', () => {
    it('rejects key not starting with S', () => {
      setValidEnv()
      process.env.STELLAR_AGENT_SECRET_KEY = 'AXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'

      expect(() => {
        require('../../../src/config/env')
      }).toThrow(/must start with S/)
    })

    it('rejects key with incorrect length', () => {
      setValidEnv()
      process.env.STELLAR_AGENT_SECRET_KEY = 'SSHORT'

      expect(() => {
        require('../../../src/config/env')
      }).toThrow(/invalid length/)
    })

    it('accepts valid 56-character key starting with S', () => {
      setValidEnv()

      const config = require('../../../src/config/env').config
      expect(config.stellar.agentSecretKey).toBe(VALID_SECRET_KEY)
    })
  })

  describe('Mainnet warning', () => {
    it('warns when mainnet is used in development', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      setValidEnv()
      process.env.STELLAR_NETWORK = 'mainnet'
      process.env.NODE_ENV = 'development'

      require('../../../src/config/env')

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CRITICAL WARNING'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('MAINNET'))

      consoleSpy.mockRestore()
    })

    it('does not warn when mainnet is used in production', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      setValidEnv()
      process.env.STELLAR_NETWORK = 'mainnet'
      process.env.NODE_ENV = 'production'

      require('../../../src/config/env')

      const criticalWarnings = consoleSpy.mock.calls.filter(call =>
        call[0]?.toString().includes('CRITICAL WARNING')
      )
      expect(criticalWarnings.length).toBe(0)

      consoleSpy.mockRestore()
    })
  })
})
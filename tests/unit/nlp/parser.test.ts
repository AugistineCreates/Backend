import {
  parseIntent,
  parseWithRegex,
  parseWithClaude,
  Intent,
} from '../../../src/nlp/parser'
import Anthropic from '@anthropic-ai/sdk'

// Mock Anthropic
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => {
    return {
      messages: {
        create: jest.fn().mockImplementation((opts: any) => {
          const content = opts.messages[opts.messages.length - 1].content
          if (content.includes('claude fallback test')) {
            return Promise.resolve({
              content: [
                { type: 'text', text: '{"action":"withdraw", "all":true}' },
              ],
            })
          }
          if (content.includes('throw test')) {
            return Promise.reject(new Error('Claude API error'))
          }
          if (content.includes('invalid json test')) {
            return Promise.resolve({
              content: [{ type: 'text', text: 'this is not valid json' }],
            })
          }
          return Promise.resolve({
            content: [{ type: 'text', text: '{"action":"help"}' }],
          })
        }),
      },
    }
  })
})

describe('NLP Parser', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('Regex Fallback Path', () => {
    // 1
    it('handles "deposit 100 USDC"', async () => {
      expect(await parseIntent('deposit 100 USDC')).toEqual({
        action: 'deposit',
        amount: 100,
        currency: 'USDC',
      })
    })
    // 2
    it('handles "withdraw everything"', async () => {
      expect(await parseIntent('withdraw everything')).toEqual({
        action: 'withdraw',
        all: true,
      })
    })
    // 3
    it('handles "withdraw 50"', async () => {
      expect(await parseIntent('withdraw 50')).toEqual({
        action: 'withdraw',
        amount: 50,
      })
    })
    // 4
    it('handles "withdraw all"', async () => {
      expect(await parseIntent('withdraw all')).toEqual({
        action: 'withdraw',
        all: true,
      })
    })
    // 5
    it('handles "withdraw 50.5 BTC"', async () => {
      expect(await parseIntent('withdraw 50.5 btc')).toEqual({
        action: 'withdraw',
        amount: 50.5,
        currency: 'BTC',
      })
    })
    // 6
    it('handles "deposit 1,000.5 USD"', async () => {
      expect(await parseIntent('deposit 1,000.5 usd')).toEqual({
        action: 'deposit',
        amount: 1000.5,
        currency: 'USD',
      })
    })
    // 7
    it('handles "balance"', async () => {
      expect(await parseIntent('balance')).toEqual({ action: 'balance' })
    })
    // 8
    it('handles "what is my balance"', async () => {
      expect(await parseIntent('what is my balance')).toEqual({
        action: 'balance',
      })
    })
    // 9
    it('handles "how much do i have"', async () => {
      expect(await parseIntent('how much do i have')).toEqual({
        action: 'balance',
      })
    })
    // 10
    it('handles "earnings"', async () => {
      expect(await parseIntent('earnings')).toEqual({ action: 'earnings' })
    })
    // 11
    it('handles "show my yield"', async () => {
      expect(await parseIntent('show my yield')).toEqual({ action: 'earnings' })
    })
    // 10
    it('handles "help"', async () => {
      expect(await parseIntent('help')).toEqual({ action: 'help' })
    })
    // 12
    it('handles "what can you do"', async () => {
      expect(await parseIntent('what can you do')).toEqual({ action: 'help' })
    })
    // 13
    it('returns null for unrecognized regex', () => {
      expect(parseWithRegex('this is completely unknown text')).toBeNull()
    })
  })

  describe('AI_MODE=local', () => {
    // 13
    it('skips Claude entirely when AI_MODE=local', async () => {
      process.env.AI_MODE = 'local'
      expect(await parseIntent('some unknown intent string')).toEqual({
        action: 'unknown',
      })
    })
    // 14
    it('still executes regex when AI_MODE=local', async () => {
      process.env.AI_MODE = 'local'
      expect(await parseIntent('deposit 50')).toEqual({
        action: 'deposit',
        amount: 50,
      })
    })
  })

  describe('Claude API Path', () => {
    // 15
    it('falls back to claude when regex fails', async () => {
      process.env.AI_MODE = 'remote'
      const result = await parseIntent('claude fallback test')
      expect(result).toEqual({ action: 'withdraw', all: true })
    })

    // 16
    it('handles general fallback using mock', async () => {
      process.env.AI_MODE = 'remote'
      const result = await parseIntent(
        "some random string that regex doesn't match"
      )
      expect(result).toEqual({ action: 'help' })
    })
  })

  describe('Error Handling', () => {
    // 17
    it('never throws even if claude throws', async () => {
      process.env.AI_MODE = 'remote'
      const result = await parseIntent('throw test')
      expect(result).toEqual({ action: 'unknown' })
    })

    // 18
    it('gracefully degrades on invalid json', async () => {
      process.env.AI_MODE = 'remote'
      const result = await parseIntent('invalid json test')
      expect(result).toEqual({ action: 'unknown' })
    })

    // 19
    it('parseWithClaude never throws', async () => {
      process.env.AI_MODE = 'remote'
      const result = await parseWithClaude('throw test')
      expect(result).toEqual({ action: 'unknown' })
    })

    // 20
    it('handles empty message', async () => {
      expect(await parseIntent('')).toEqual({ action: 'unknown' })
    })
  })
})

/**
 * Unit tests for src/whatsapp/handler.ts
 * userManager and NLP parser are fully mocked.
 */

jest.mock('../../../src/whatsapp/userManager', () => ({
  normalizePhone: jest.fn((p: string) => p.replace(/^whatsapp:/i, '').trim()),
  createOrGetUser: jest.fn(),
  generateOtp: jest.fn().mockReturnValue('654321'),
  verifyOtp: jest.fn(),
  getBalance: jest.fn(),
  getUserWalletAddress: jest.fn(),
  getPortfolioYieldSummary: jest.fn(),
  decrementBalance: jest.fn(),
}))

jest.mock('../../../src/nlp/parser', () => ({
  parseIntent: jest.fn(),
}))

import { handleWhatsAppMessage } from '../../../src/whatsapp/handler'
import * as userManagerModule from '../../../src/whatsapp/userManager'
import { parseIntent } from '../../../src/nlp/parser'

const mockUM = userManagerModule as jest.Mocked<typeof userManagerModule>
const mockParseIntent = parseIntent as jest.Mock

const PHONE = 'whatsapp:+10000000099'

const VERIFIED_USER = {
  id: 'user-handler-1',
  phone: '+10000000099',
  verified: true,
  walletAddress: 'GABC999',
  balance: 100,
}

const UNVERIFIED_USER = { ...VERIFIED_USER, verified: false }

describe('handleWhatsAppMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUM.normalizePhone.mockImplementation((p) =>
      p.replace(/^whatsapp:/i, '').trim()
    )
    mockUM.createOrGetUser.mockResolvedValue(VERIFIED_USER as any)
    mockUM.getBalance.mockReturnValue(100)
    mockUM.getUserWalletAddress.mockReturnValue('GABC999')
    mockUM.getPortfolioYieldSummary.mockResolvedValue({
      totalBalance: 100,
      totalEarnings: 12.5,
      periodEarnings: 2.25,
      averageApy: 0.0835,
    } as any)
    mockUM.decrementBalance.mockReturnValue(50)
    mockUM.generateOtp.mockReturnValue('654321')
  })

  // ── Unverified user — OTP flow ────────────────────────────────────────────

  describe('unverified user', () => {
    beforeEach(() => {
      mockUM.createOrGetUser.mockResolvedValue(UNVERIFIED_USER as any)
    })

    it('sends an OTP when the message is not a 6-digit code', async () => {
      const { body } = await handleWhatsAppMessage(PHONE, 'hello')
      expect(body).toContain('654321')
    })

    it('welcomes user and shows wallet after valid OTP', async () => {
      mockUM.verifyOtp.mockReturnValue(true)
      const { body } = await handleWhatsAppMessage(PHONE, '654321')
      expect(body).toContain('verified')
      expect(body).toContain('GABC999')
    })

    it('rejects an invalid OTP code', async () => {
      mockUM.verifyOtp.mockReturnValue(false)
      const { body } = await handleWhatsAppMessage(PHONE, '000000')
      expect(body).toContain('Invalid')
    })
  })

  // ── Verified user — intent routing ────────────────────────────────────────

  describe('verified user', () => {
    it('handles balance intent', async () => {
      mockParseIntent.mockResolvedValue({ action: 'balance' })
      const { body } = await handleWhatsAppMessage(PHONE, 'balance')
      expect(body).toContain('100.00 XLM')
      expect(body).toContain('GABC999')
    })

    it('handles deposit intent with a valid amount', async () => {
      mockParseIntent.mockResolvedValue({ action: 'deposit', amount: 75 })
      const { body } = await handleWhatsAppMessage(PHONE, 'deposit 75')
      expect(body).toContain('75.00 XLM')
      expect(body).toContain('GABC999')
    })

    it('prompts for amount when deposit amount is missing', async () => {
      mockParseIntent.mockResolvedValue({ action: 'deposit', amount: 0 })
      const { body } = await handleWhatsAppMessage(PHONE, 'deposit')
      expect(body).toContain('specify')
    })

    it('handles withdraw intent within balance', async () => {
      mockParseIntent.mockResolvedValue({ action: 'withdraw', amount: 40 })
      const { body } = await handleWhatsAppMessage(PHONE, 'withdraw 40')
      expect(body).toContain('40.00 XLM')
    })

    it('handles withdraw-all intent', async () => {
      mockParseIntent.mockResolvedValue({ action: 'withdraw', all: true })
      const { body } = await handleWhatsAppMessage(PHONE, 'withdraw all')
      expect(body).toBeDefined()
    })

    it('returns insufficient-funds message when amount exceeds balance', async () => {
      mockParseIntent.mockResolvedValue({ action: 'withdraw', amount: 9999 })
      const { body } = await handleWhatsAppMessage(PHONE, 'withdraw 9999')
      expect(body).toContain('only have')
    })

    it('prompts for amount when withdraw amount is missing', async () => {
      mockParseIntent.mockResolvedValue({ action: 'withdraw', amount: 0 })
      const { body } = await handleWhatsAppMessage(PHONE, 'withdraw')
      expect(body).toContain('specify')
    })

    it('handles help intent', async () => {
      mockParseIntent.mockResolvedValue({ action: 'help' })
      const { body } = await handleWhatsAppMessage(PHONE, 'help')
      expect(body).toContain('deposit')
    })

    it('handles earnings intent with tracked portfolio data', async () => {
      mockParseIntent.mockResolvedValue({ action: 'earnings' })
      const { body } = await handleWhatsAppMessage(PHONE, 'earnings')
      expect(body).toContain('12.50 XLM')
      expect(body).toContain('2.25 XLM')
      expect(body).toContain('8.35%')
      expect(body).not.toContain('4% APY')
    })

    it('returns a helpful message when no portfolio data is available', async () => {
      mockParseIntent.mockResolvedValue({ action: 'earnings' })
      mockUM.getPortfolioYieldSummary.mockResolvedValue(null as any)
      const { body } = await handleWhatsAppMessage(PHONE, 'earnings')
      expect(body).toContain('tracked portfolio data')
    })

    it('handles unknown intent', async () => {
      mockParseIntent.mockResolvedValue({ action: 'unknown' })
      const { body } = await handleWhatsAppMessage(PHONE, 'gibberish')
      expect(body).toContain("didn't understand")
    })

    it('falls through to unknown for unrecognised actions', async () => {
      mockParseIntent.mockResolvedValue({ action: 'anything_else' })
      const { body } = await handleWhatsAppMessage(PHONE, 'anything')
      expect(body).toContain("didn't understand")
    })
  })
})

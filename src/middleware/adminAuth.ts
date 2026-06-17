import type { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import db from '../db'
import { logger } from '../utils/logger'

const prisma = db as any

export interface AdminAuthContext {
  id: string
  name: string
  role: string
  scopes: string[]
}

/**
 * Derive a fast, non-secret SHA-256 prefix stored alongside the bcrypt hash.
 * This lets us narrow the candidate set to (usually) 1 row before paying the
 * full bcrypt cost, eliminating the O(n·bcrypt) scan vulnerability.
 *
 * Format stored in DB:  `sha256:<hex digest>`
 * Column name:          `tokenPrefix`  (add to AdminApiKey model in schema.prisma)
 */
function deriveTokenPrefix(rawToken: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(rawToken).digest('hex')
}

function getTokenFromRequest(req: Request): string | undefined {
  const authHeader = req.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token) return token
  }

  // Legacy header — kept for backwards compat during migration; remove after
  // all callers have switched to Bearer.
  const legacyHeader = req.headers['x-admin-token']
  if (Array.isArray(legacyHeader)) {
    return legacyHeader[0]?.trim() || undefined
  }
  if (typeof legacyHeader === 'string') {
    return legacyHeader.trim() || undefined
  }

  return undefined
}

function unauthorized(res: Response): void {
  res.status(401).json({
    success: false,
    error: 'Admin authentication required',
  })
}

function forbidden(res: Response): void {
  res.status(403).json({
    success: false,
    error: 'Admin access revoked or expired',
  })
}

export async function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawToken = getTokenFromRequest(req)

  if (!rawToken) {
    unauthorized(res)
    return
  }

  try {
    const now = new Date()
    const tokenPrefix = deriveTokenPrefix(rawToken)

    // ── Narrow candidate set via the fast SHA-256 prefix ──────────────────
    // The WHERE clause filters out revoked/expired rows AND uses tokenPrefix
    // to avoid a full-table bcrypt scan.  Typically returns exactly 1 row.
    const candidates = await prisma.adminApiKey.findMany({
      where: {
        tokenPrefix,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        id: true,
        name: true,
        role: true,
        scopes: true,
        hash: true,
      },
    })

    let matched: AdminAuthContext | null = null

    for (const candidate of candidates) {
      const isMatch = await bcrypt.compare(rawToken, candidate.hash)
      if (!isMatch) continue

      matched = {
        id: candidate.id,
        name: candidate.name,
        role: candidate.role,
        scopes: candidate.scopes,
      }
      break
    }

    if (!matched) {
      logger.warn('[AdminAuth] Invalid admin token attempt', {
        ip: req.ip,
        path: req.originalUrl || req.path,
        method: req.method,
      })
      forbidden(res)
      return
    }

    // ── Update lastUsedAt asynchronously — don't block the request ────────
    prisma.adminApiKey
      .update({
        where: { id: matched.id },
        data: { lastUsedAt: now },
      })
      .catch((err: unknown) => {
        logger.warn('[AdminAuth] Failed to update lastUsedAt', {
          id: matched!.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })

    res.locals.adminAuth = matched
    next()
  } catch (error) {
    logger.error('[AdminAuth] Middleware error', error)
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    })
  }
}

export function requireAdminScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = res.locals.adminAuth as AdminAuthContext | undefined

    if (!auth || !auth.scopes.includes(scope)) {
      res.status(403).json({
        success: false,
        error: `Admin scope '${scope}' required`,
      })
      return
    }

    next()
  }
}
import { type Express } from 'express'
import helmet from 'helmet'
import { config } from '../config/env'

/**
 * Apply Express `trust proxy` so `req.ip`, `req.protocol`, and rate-limit
 * keys reflect the real client when the app sits behind a reverse proxy.
 *
 * Configure via `TRUST_PROXY` (default: `1` — one hop). See `.env.example`.
 */
export function configureTrustProxy(app: Express): void {
  app.set('trust proxy', config.security.trustProxy)
}

/**
 * Helmet security headers.
 *
 * Production uses strict defaults (CSP, HSTS, CORP/COOP). Development and
 * test disable CSP/HSTS so local tooling is not blocked.
 */
export function securityHeaders() {
  const isProduction = config.nodeEnv === 'production'

  return helmet({
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: isProduction,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: isProduction
      ? {
          maxAge: 31_536_000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
    referrerPolicy: { policy: 'no-referrer' },
  })
}

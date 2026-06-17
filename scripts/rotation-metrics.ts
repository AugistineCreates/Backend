/**
 * Wallet Key Rotation Metrics & Logging Utilities
 * 
 * Provides structured logging and metrics collection for key rotation operations.
 * Metrics are saved to JSON file and can be integrated with monitoring systems.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface RotationMetrics {
  // Timing
  startTime: Date;
  endTime?: Date;
  durationMs?: number;

  // Counts
  totalWallets: number;
  successfullyRotated: number;
  failedRotations: number;
  skipped: number;

  // Performance
  // totalRotationTimeMs is an internal accumulator (sum of per-wallet
  // decrypt+encrypt+write durations) used to derive avg/min/max below.
  totalRotationTimeMs?: number;
  avgRotationTimeMs?: number;
  minRotationTimeMs?: number;
  maxRotationTimeMs?: number;
  throughputWalletsPerSecond?: number;

  // Errors
  errors: RotationError[];

  // Metadata
  rotationId: string;
  dryRun: boolean;
  timestamp: string;
  environment: string;
  databaseUrl?: string; // Redacted
}

export interface RotationError {
  walletId: string;
  userId: string;
  error: string;
  timestamp: string;
}

export interface RotationProgress {
  current: number;
  total: number;
  percent: number;
  walletsPerSecond: number;
  estimatedSecondsRemaining: number;
}

/**
 * Redact sensitive information from database URL for logging
 */
export function redactDatabaseUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Keep only host, port, and database name
    return `${urlObj.protocol}//*:**@${urlObj.host}${urlObj.pathname}`;
  } catch {
    return '***redacted***';
  }
}

/**
 * Create a unique rotation ID for tracking
 */
export function generateRotationId(): string {
  return `rotation-${crypto.randomBytes(8).toString('hex')}-${Date.now()}`;
}

/**
 * Initialize metrics object
 */
export function initializeMetrics(dryRun: boolean = false): RotationMetrics {
  const databaseUrl = process.env.DATABASE_URL;
  
  return {
    startTime: new Date(),
    totalWallets: 0,
    successfullyRotated: 0,
    failedRotations: 0,
    skipped: 0,
    errors: [],
    rotationId: generateRotationId(),
    dryRun,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    databaseUrl: databaseUrl ? redactDatabaseUrl(databaseUrl) : undefined,
  };
}

/**
 * Calculate progress metrics
 */
export function calculateProgress(
  metrics: RotationMetrics
): RotationProgress {
  if (metrics.totalWallets === 0) {
    return {
      current: 0,
      total: 0,
      percent: 0,
      walletsPerSecond: 0,
      estimatedSecondsRemaining: 0,
    };
  }

  const processed = metrics.successfullyRotated + metrics.failedRotations;
  const elapsedMs = Date.now() - metrics.startTime.getTime();
  const elapsedSeconds = elapsedMs / 1000;

  const walletsPerSecond = elapsedSeconds > 0 ? processed / elapsedSeconds : 0;
  const remainingWallets = metrics.totalWallets - processed;
  const estimatedSecondsRemaining =
    walletsPerSecond > 0 ? remainingWallets / walletsPerSecond : 0;

  return {
    current: processed,
    total: metrics.totalWallets,
    percent: Math.round((processed / metrics.totalWallets) * 100),
    walletsPerSecond: Math.round(walletsPerSecond * 100) / 100,
    estimatedSecondsRemaining: Math.round(estimatedSecondsRemaining),
  };
}

/**
 * Finalize metrics after rotation completes.
 *
 * IMPORTANT: this is a pure function — it returns a NEW metrics object with
 * endTime/durationMs/etc. filled in rather than mutating the object you pass
 * in. Callers must use the return value:
 *
 *   const finalized = finalizeMetrics(metrics);
 *   // use `finalized`, not the original `metrics`, from here on
 */
export function finalizeMetrics(metrics: RotationMetrics): RotationMetrics {
  const endTime = new Date();
  const durationMs = endTime.getTime() - metrics.startTime.getTime();

  const processed = metrics.successfullyRotated + metrics.failedRotations;
  const durationSeconds = durationMs / 1000;

  // Prefer real per-wallet timings (accumulated via recordSuccess's
  // durationMs argument) when available. Fall back to a coarse estimate
  // (wall-clock duration / wallets processed) only if no per-wallet timing
  // was recorded — that estimate includes DB round-trip and progress-log
  // overhead, so it's a rough upper bound, not a precise per-op time.
  const avgRotationTimeMs =
    metrics.totalRotationTimeMs !== undefined && metrics.successfullyRotated > 0
      ? Math.round((metrics.totalRotationTimeMs / metrics.successfullyRotated) * 100) / 100
      : processed > 0
        ? Math.round((durationMs / processed) * 100) / 100
        : undefined;

  return {
    ...metrics,
    endTime,
    durationMs,
    avgRotationTimeMs,
    minRotationTimeMs: metrics.minRotationTimeMs,
    maxRotationTimeMs: metrics.maxRotationTimeMs,
    throughputWalletsPerSecond:
      durationSeconds > 0
        ? Math.round((processed / durationSeconds) * 100) / 100
        : undefined,
  };
}

/**
 * Add an error to the metrics
 */
export function recordError(
  metrics: RotationMetrics,
  walletId: string,
  userId: string,
  error: string
): void {
  metrics.failedRotations += 1;
  metrics.errors.push({
    walletId,
    userId,
    error,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Record a successful rotation.
 * Pass the wall-clock duration (ms) of this wallet's decrypt+encrypt+write
 * so finalizeMetrics can report real avg/min/max instead of an estimate.
 */
export function recordSuccess(metrics: RotationMetrics, durationMs?: number): void {
  metrics.successfullyRotated += 1;

  if (typeof durationMs === 'number') {
    metrics.totalRotationTimeMs = (metrics.totalRotationTimeMs ?? 0) + durationMs;
    metrics.minRotationTimeMs =
      metrics.minRotationTimeMs === undefined ? durationMs : Math.min(metrics.minRotationTimeMs, durationMs);
    metrics.maxRotationTimeMs =
      metrics.maxRotationTimeMs === undefined ? durationMs : Math.max(metrics.maxRotationTimeMs, durationMs);
  }
}

/**
 * Record a skipped wallet
 */
export function recordSkipped(metrics: RotationMetrics): void {
  metrics.skipped += 1;
}

/**
 * Save metrics to a JSON file
 */
export function saveMetricsToFile(
  metrics: RotationMetrics,
  outputDir: string = process.cwd()
): string {
  const filename = `wallet-rotation-${metrics.rotationId}.json`;
  const filepath = path.join(outputDir, filename);

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write metrics file
  fs.writeFileSync(filepath, JSON.stringify(metrics, null, 2));

  // Also create a summary file for quick reference
  const summaryFilepath = path.join(outputDir, `wallet-rotation-summary-${metrics.rotationId}.txt`);
  const summary = formatMetricsSummary(metrics);
  fs.writeFileSync(summaryFilepath, summary);

  return filepath;
}

/**
 * Format metrics as human-readable summary
 */
export function formatMetricsSummary(metrics: RotationMetrics): string {
  const durationSec = metrics.durationMs ? (metrics.durationMs / 1000).toFixed(2) : 'N/A';
  const successRate =
    metrics.totalWallets > 0
      ? Math.round((metrics.successfullyRotated / metrics.totalWallets) * 10000) / 100
      : 0;

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Custodial Wallet Key Rotation - Summary Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Rotation Metrics:
  Rotation ID:           ${metrics.rotationId}
  Mode:                  ${metrics.dryRun ? 'DRY RUN' : 'LIVE'}
  Timestamp:             ${metrics.timestamp}
  Environment:           ${metrics.environment}

📈 Results:
  Total wallets:         ${metrics.totalWallets}
  Successfully rotated:  ${metrics.successfullyRotated} (${successRate}%)
  Failed:                ${metrics.failedRotations}
  Skipped:               ${metrics.skipped}

⏱️  Performance:
  Duration:              ${durationSec}s
  Throughput:            ${metrics.throughputWalletsPerSecond ?? 'N/A'} wallets/sec
  Avg time per wallet:   ${metrics.avgRotationTimeMs !== undefined ? metrics.avgRotationTimeMs + 'ms' : 'N/A'}
  Min time per wallet:   ${metrics.minRotationTimeMs !== undefined ? metrics.minRotationTimeMs + 'ms' : 'N/A'}
  Max time per wallet:   ${metrics.maxRotationTimeMs !== undefined ? metrics.maxRotationTimeMs + 'ms' : 'N/A'}

${metrics.errors.length > 0 ? `⚠️  Errors (${metrics.errors.length}):` : ''}
${metrics.errors
  .slice(0, 10)
  .map((err) => `  - ${err.userId.substring(0, 8)}... (${err.walletId.substring(0, 8)}...): ${err.error}`)
  .join('\n')}
${metrics.errors.length > 10 ? `  ... and ${metrics.errors.length - 10} more\n` : ''}

Status: ${metrics.failedRotations === 0 ? '✅ SUCCESS' : '❌ FAILED'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}

/**
 * Export metrics in Prometheus format for integration
 */
export function formatMetricsPrometheus(metrics: RotationMetrics): string {
  const lines: string[] = [
    '# HELP wallet_rotation_total Total wallets processed during rotation',
    '# TYPE wallet_rotation_total gauge',
    `wallet_rotation_total{rotation_id="${metrics.rotationId}",status="success"} ${metrics.successfullyRotated}`,
    `wallet_rotation_total{rotation_id="${metrics.rotationId}",status="failed"} ${metrics.failedRotations}`,
    `wallet_rotation_total{rotation_id="${metrics.rotationId}",status="skipped"} ${metrics.skipped}`,
    '',
    '# HELP wallet_rotation_duration_seconds Duration of wallet rotation in seconds',
    '# TYPE wallet_rotation_duration_seconds gauge',
    `wallet_rotation_duration_seconds{rotation_id="${metrics.rotationId}"} ${(metrics.durationMs || 0) / 1000}`,
    '',
    '# HELP wallet_rotation_throughput_walletsps Throughput of wallet rotation in wallets per second',
    '# TYPE wallet_rotation_throughput_walletsps gauge',
    `wallet_rotation_throughput_walletsps{rotation_id="${metrics.rotationId}"} ${metrics.throughputWalletsPerSecond || 0}`,
  ];

  return lines.join('\n');
}

/**
 * Log rotation progress to console with formatting
 */
export function logRotationProgress(
  metrics: RotationMetrics,
  progress: RotationProgress,
  currentUserId?: string
): void {
  if (progress.total === 0) return;

  const progressBar = createProgressBar(progress.percent, 50);
  const eta = formatTimeRemaining(progress.estimatedSecondsRemaining);

  console.log(
    `${progressBar} ${progress.percent}% (${progress.current}/${progress.total}) ` +
      `${progress.walletsPerSecond} wallets/sec ETA: ${eta}`
  );
}

/**
 * Create a simple text-based progress bar
 */
function createProgressBar(percent: number, width: number = 50): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${'\u2588'.repeat(filled)}${'\u2591'.repeat(empty)}]`;
}

/**
 * Format seconds into human-readable time
 */
function formatTimeRemaining(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
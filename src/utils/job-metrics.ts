import client from 'prom-client'
import { register } from './metrics-registry'

export const jobSuccessTotal = new client.Counter({
  name: 'job_success_total',
  help: 'Total number of successful background job executions',
  labelNames: ['job_name'] as const,
  registers: [register],
})

export const jobFailureTotal = new client.Counter({
  name: 'job_failure_total',
  help: 'Total number of failed background job executions',
  labelNames: ['job_name'] as const,
  registers: [register],
})

export const jobDurationMs = new client.Histogram({
  name: 'job_duration_ms',
  help: 'Duration of background job executions in milliseconds',
  labelNames: ['job_name'] as const,
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000, 60000],
  registers: [register],
})

export function recordJobSuccess(jobName: string, durationMs: number): void {
  jobSuccessTotal.inc({ job_name: jobName })
  jobDurationMs.observe({ job_name: jobName }, durationMs)
}

export function recordJobFailure(jobName: string, durationMs: number): void {
  jobFailureTotal.inc({ job_name: jobName })
  jobDurationMs.observe({ job_name: jobName }, durationMs)
}

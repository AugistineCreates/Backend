-- Add indexes to support efficient retention/cleanup queries
-- These indexes cover the WHERE clauses used by the data retention jobs

-- auth_nonces: already has @@index([expiresAt]) in schema, ensure it exists
CREATE INDEX IF NOT EXISTS "auth_nonces_expiresAt_idx" ON "auth_nonces"("expiresAt");

-- processed_events: index on processedAt for time-based pruning
CREATE INDEX IF NOT EXISTS "processed_events_processedAt_idx" ON "processed_events"("processedAt");

-- dead_letter_events: index on (status, createdAt) for RESOLVED+age cleanup
CREATE INDEX IF NOT EXISTS "dead_letter_events_status_createdAt_idx" ON "dead_letter_events"("status", "createdAt");

-- agent_logs: already has @@index([createdAt]), ensure it exists
CREATE INDEX IF NOT EXISTS "agent_logs_createdAt_idx" ON "agent_logs"("createdAt");

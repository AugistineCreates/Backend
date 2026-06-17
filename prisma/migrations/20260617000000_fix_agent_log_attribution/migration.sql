-- Fix agent action logging to attribute rebalances per user/position
--
-- 1. Make userId nullable so system-level scans produce logs without a user.
-- 2. Add positionId so rebalance logs reference the impacted position.
-- 3. Add composite index (userId, createdAt) for hot analytics queries.

-- Make userId nullable
ALTER TABLE "agent_logs" ALTER COLUMN "userId" DROP NOT NULL;

-- Add positionId column (nullable)
ALTER TABLE "agent_logs" ADD COLUMN "positionId" TEXT;

-- Index positionId for look-ups
CREATE INDEX "agent_logs_positionId_idx" ON "agent_logs"("positionId");

-- Composite index: userId + createdAt (hot path for per-user audit queries)
CREATE INDEX "agent_logs_userId_createdAt_idx" ON "agent_logs"("userId", "createdAt");

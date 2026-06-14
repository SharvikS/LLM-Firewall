-- Migration 008: widen the tenant tier CHECK to the billing plan catalog.
-- The original schema only allowed ('standard','enterprise'); the billing plane
-- introduces free/starter/pro/enterprise plans. 'standard' is kept permitted so
-- pre-existing rows remain valid (the billing catalog maps unknown/legacy tiers
-- to the most restrictive plan).

-- Migrations are re-applied on every boot, so this must be idempotent:
--   * DROP ... IF EXISTS  — no-op once the old constraint is gone.
--   * ADD  ... IF NOT EXISTS — no-op once the new constraint exists.
-- A new constraint name is used because CockroachDB cannot drop and re-add a
-- constraint of the same name in one transaction.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS check_tier;
ALTER TABLE tenants ADD CONSTRAINT IF NOT EXISTS tenants_tier_plan_check
    CHECK (tier IN ('free','starter','pro','enterprise','standard'));

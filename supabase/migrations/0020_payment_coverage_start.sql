-- 0020 — Add coverage_start to payments
-- Stores the first day of the period a payment covers.
-- For advance payments collected in May for July coverage, date=May, coverage_start=July.
-- Used by removePayment to correctly revert student paidTill.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS coverage_start DATE;

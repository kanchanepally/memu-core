-- Story 1.4: Twin enforcement as runtime invariant.
-- When the guard catches a real family entity in an outbound LLM prompt,
-- we record which entities were about to leak. In production mode this
-- co-exists with a successful dispatch (we anonymise and proceed);
-- in development mode the dispatch is blocked and the row is status='error'.

ALTER TABLE privacy_ledger
  ADD COLUMN IF NOT EXISTS twin_violations JSONB;

CREATE INDEX IF NOT EXISTS idx_privacy_ledger_twin_violations
  ON privacy_ledger((twin_violations IS NOT NULL))
  WHERE twin_violations IS NOT NULL;

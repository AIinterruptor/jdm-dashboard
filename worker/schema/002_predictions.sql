-- Prediction board for newsph.jdmaisolutions.com
--
-- Design notes that matter:
--
-- 1. Votes are APPEND-ONLY (one row per vote), never a counter. A KV counter or
--    an UPDATE ... SET n = n + 1 is read-modify-write and silently drops votes
--    under concurrency. The aggregate is computed and cached instead.
--
-- 2. This is the site's FIRST unauthenticated write endpoint. The worker's
--    checkRateLimit() is a module-level Map — per-isolate and reset constantly —
--    so it is no defence at all here. The UNIQUE index on (question_id, voter)
--    is what actually bounds ballot-stuffing.
--
-- 3. `voter` is a SALTED SHA-256 of the client IP, never the address itself.
--    This site has collected no personal data anywhere and is not starting now;
--    the hash is only ever compared, never reversed or displayed.
--
-- 4. The model's probability and the crowd's are stored SEPARATELY against the
--    same outcome. If the generator saw the tally it would anchor on it, and the
--    crowd is reading the model's published number — that loop would manufacture
--    confidence out of its own output. Kept independent so both mean something.

CREATE TABLE IF NOT EXISTS questions (
  id            TEXT PRIMARY KEY,           -- e.g. q-20260910-usdphp
  opened_at     INTEGER NOT NULL,           -- ms epoch
  closes_at     INTEGER NOT NULL,           -- voting shuts; must precede resolution
  resolves_at   INTEGER NOT NULL,           -- when the criterion can be checked
  category      TEXT NOT NULL,              -- economy | politics | disaster | health | social
  question      TEXT NOT NULL,              -- a single specific claim, answerable yes/no
  criterion     TEXT NOT NULL,              -- EXACTLY what settles it, in plain words
  source_hint   TEXT,                       -- where the settling figure will come from
  model_prob    INTEGER NOT NULL,           -- 0-100, the model's own forecast
  model_reason  TEXT,                       -- why, naming the figure it used
  auto_rule     TEXT,                       -- JSON for deterministic resolution, else NULL
  status        TEXT NOT NULL DEFAULT 'open', -- open | closed | resolved | voided
  outcome       INTEGER,                    -- 1 yes, 0 no, NULL unresolved
  resolved_at   INTEGER,
  resolved_by   TEXT,                       -- 'auto' | 'model' | 'admin'
  resolve_note  TEXT
);
CREATE INDEX IF NOT EXISTS idx_q_status ON questions(status, resolves_at);
CREATE INDEX IF NOT EXISTS idx_q_opened ON questions(opened_at DESC);

CREATE TABLE IF NOT EXISTS votes (
  question_id TEXT NOT NULL,
  voter       TEXT NOT NULL,                -- salted hash of IP; never the IP
  choice      INTEGER NOT NULL,             -- 1 yes, 0 no
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (question_id, voter)          -- one ballot per voter per question
);
CREATE INDEX IF NOT EXISTS idx_v_q ON votes(question_id);

-- Written once at resolution so the track record is a stored fact rather than a
-- number recomputed (and quietly changed) on every page load.
CREATE TABLE IF NOT EXISTS scores (
  question_id TEXT PRIMARY KEY,
  resolved_at INTEGER NOT NULL,
  outcome     INTEGER NOT NULL,
  model_prob  INTEGER NOT NULL,
  crowd_prob  INTEGER,                      -- NULL when nobody voted
  votes       INTEGER NOT NULL DEFAULT 0,
  -- Brier score: (probability - outcome)^2, stored x10000 as an integer.
  -- Lower is better; 0.25 is what you get by always saying 50%.
  model_brier INTEGER NOT NULL,
  crowd_brier INTEGER
);

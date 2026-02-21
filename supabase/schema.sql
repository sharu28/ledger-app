-- ============================================================
-- LEDGER DIGITIZER - Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- Users table (identified by WhatsApp phone number)
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,            -- WhatsApp number e.g. "+94771234567"
  name TEXT,
  currency TEXT DEFAULT 'LKR',
  custom_categories TEXT[] DEFAULT '{}', -- user-added categories
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW()
);

-- Scanned ledger pages (stores metadata about each photo processed)
CREATE TABLE IF NOT EXISTS pages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  image_url TEXT,                        -- optional: store in Supabase Storage
  page_notes TEXT,
  currency_detected TEXT,
  confidence TEXT,                       -- high/medium/low
  transaction_count INT DEFAULT 0,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual transactions extracted from pages
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  page_id UUID REFERENCES pages(id) ON DELETE SET NULL,
  date TEXT NOT NULL,                    -- as extracted (may not be clean date)
  parsed_date DATE,                      -- cleaned date for sorting/filtering
  description TEXT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('debit', 'credit')),
  category TEXT NOT NULL,
  is_unclear BOOLEAN DEFAULT FALSE,      -- flagged if AI wasn't confident
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(user_id, parsed_date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_pages_user ON pages(user_id);

-- Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Policy: service role can do everything (for the WhatsApp bot backend)
-- The publishable key is used by the web dashboard with phone-based auth
CREATE POLICY "Service role full access" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON transactions FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Conversation messages (for query context)
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',        -- 'text', 'image', 'query_result'
  metadata JSONB DEFAULT '{}',             -- store generated SQL, result count, etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_user ON conversation_messages(user_id, created_at DESC);

ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON conversation_messages FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Function: Secure read-only SQL executor for conversational queries
-- ============================================================
CREATE OR REPLACE FUNCTION run_user_query(query_text TEXT, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Only allow SELECT statements
  IF NOT (UPPER(TRIM(query_text)) LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'Only SELECT queries allowed';
  END IF;

  -- Execute the query with user_id as $1 parameter
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t',
    query_text
  )
  USING p_user_id
  INTO result;

  RETURN result;
END;
$$;

-- ============================================================
-- Pending extractions (two-step workflow state)
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_extractions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'awaiting_confirmation'
    CHECK (status IN ('awaiting_confirmation', 'confirmed', 'declined', 'expired')),
  raw_extraction JSONB NOT NULL,          -- digitized rows before categorization
  content_type TEXT,                       -- 'expenses', 'inventory', 'sales', 'mixed', 'unknown'
  follow_up_question TEXT,                -- the AI-generated question sent to user
  image_url TEXT,                          -- R2 URL of the original image
  pdf_url TEXT,                            -- R2 URL of the generated PDF
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_extractions(user_id, status);

ALTER TABLE pending_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON pending_extractions FOR ALL USING (true) WITH CHECK (true);

-- Add pdf_url column to pages table (if not present)
ALTER TABLE pages ADD COLUMN IF NOT EXISTS pdf_url TEXT;

-- ============================================================
-- Categories reference (for documentation)
-- Revenue / Sales, Inventory / Stock, Salaries / Wages,
-- Shop Expenses, Transport / Fuel, Food / Meals, Utilities,
-- Office Supplies, Marketing / Ads, Repairs / Maintenance,
-- Owner Drawings, Insurance, Taxes / Fees, Loan / Interest,
-- Miscellaneous
-- ============================================================

-- ============================================================
-- VIEW: Monthly summary per user
-- ============================================================
CREATE OR REPLACE VIEW monthly_summary AS
SELECT
  user_id,
  DATE_TRUNC('month', parsed_date) AS month,
  SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) AS total_expenses,
  SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) AS total_income,
  SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END) AS net,
  COUNT(*) AS transaction_count
FROM transactions
WHERE parsed_date IS NOT NULL
GROUP BY user_id, DATE_TRUNC('month', parsed_date)
ORDER BY month DESC;

-- ============================================================
-- VIEW: Category breakdown per user
-- ============================================================
CREATE OR REPLACE VIEW category_breakdown AS
SELECT
  user_id,
  category,
  type,
  SUM(amount) AS total,
  COUNT(*) AS count,
  DATE_TRUNC('month', parsed_date) AS month
FROM transactions
WHERE parsed_date IS NOT NULL
GROUP BY user_id, category, type, DATE_TRUNC('month', parsed_date)
ORDER BY total DESC;

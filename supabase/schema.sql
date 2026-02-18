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
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_date ON transactions(user_id, parsed_date);
CREATE INDEX idx_transactions_category ON transactions(user_id, category);
CREATE INDEX idx_pages_user ON pages(user_id);

-- Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Policy: service role can do everything (for the WhatsApp bot backend)
-- The anon key is used by the web dashboard with phone-based auth
CREATE POLICY "Service role full access" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON transactions FOR ALL USING (true) WITH CHECK (true);

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

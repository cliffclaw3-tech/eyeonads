-- EyeOnAds Supabase Schema
-- Run this in the Supabase SQL Editor after creating your project

-- Enable pgcrypto for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- BROKERAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS brokerages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  broker_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_code TEXT UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- USERS (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'broker')),
  brokerage_id UUID REFERENCES brokerages(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'TN' CHECK (state IN ('TN', 'VA', 'NC')),
  license_number TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'agent', 'broker')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AD ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('meta', 'google')),
  -- Store encrypted OAuth token: pgp_sym_encrypt(token, app_secret)
  oauth_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  account_id TEXT,
  account_name TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  needs_reconnect BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (user_id, platform)
);

-- ============================================================
-- AD PERFORMANCE
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  spend NUMERIC(10, 2) NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  ctr NUMERIC(8, 6) GENERATED ALWAYS AS (
    CASE WHEN impressions > 0 THEN clicks::numeric / impressions ELSE 0 END
  ) STORED,
  ad_set_name TEXT NOT NULL,
  ad_id TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('meta', 'google')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for date-range queries
CREATE INDEX IF NOT EXISTS idx_ad_performance_account_date
  ON ad_performance (ad_account_id, date DESC);

-- ============================================================
-- COMPLIANCE SCANS
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_id TEXT,
  ad_copy TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'TN',
  result TEXT NOT NULL CHECK (result IN ('green', 'yellow', 'red')),
  flags JSONB NOT NULL DEFAULT '[]',
  ai_explanation TEXT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_scans_user_date
  ON compliance_scans (user_id, scanned_at DESC);

-- ============================================================
-- WEEKLY REPORTS
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  report_json JSONB NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, report_date)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- user_profiles: each user sees only their own row
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile"
  ON user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile"
  ON user_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile"
  ON user_profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Brokers can see profiles of agents in their brokerage (read-only for compliance)
CREATE POLICY "Brokers can view agents in their brokerage"
  ON user_profiles FOR SELECT
  USING (
    brokerage_id IN (
      SELECT id FROM brokerages WHERE broker_user_id = auth.uid()
    )
  );

-- brokerages: public read by invite_code, owner manages
ALTER TABLE brokerages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read brokerage by lookup"
  ON brokerages FOR SELECT USING (true);
CREATE POLICY "Broker can update their brokerage"
  ON brokerages FOR UPDATE USING (broker_user_id = auth.uid());
CREATE POLICY "Broker can insert brokerage"
  ON brokerages FOR INSERT WITH CHECK (broker_user_id = auth.uid());

-- ad_accounts: user owns their own
ALTER TABLE ad_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their ad accounts"
  ON ad_accounts FOR ALL USING (user_id = auth.uid());

-- ad_performance: user owns data via ad_account
ALTER TABLE ad_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their ad performance"
  ON ad_performance FOR ALL
  USING (
    ad_account_id IN (
      SELECT id FROM ad_accounts WHERE user_id = auth.uid()
    )
  );

-- compliance_scans: user owns their scans; broker can see result (not full copy) for agents
ALTER TABLE compliance_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their compliance scans"
  ON compliance_scans FOR ALL USING (user_id = auth.uid());

-- Brokers can see compliance results (not ad_copy) for agents in their brokerage
CREATE POLICY "Brokers can see compliance results for their agents"
  ON compliance_scans FOR SELECT
  USING (
    user_id IN (
      SELECT up.id FROM user_profiles up
      JOIN brokerages b ON b.id = up.brokerage_id
      WHERE b.broker_user_id = auth.uid()
    )
  );

-- weekly_reports: user owns their reports
ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their weekly reports"
  ON weekly_reports FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- FUNCTIONS / TRIGGERS
-- ============================================================

-- Auto-create user_profiles row when auth.users is created
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO user_profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

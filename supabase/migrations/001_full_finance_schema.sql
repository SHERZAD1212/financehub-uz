-- ============================================================
-- FinanceHub UZ — to'liq buxgalteriya sxemasi (P/L, Cash Flow, Balans)
-- ============================================================
-- BU FAYLNI QO'LDA, Supabase Dashboard > SQL Editor'da ishga tushiring.
-- Ilova kodi (app.js) shu jadvallarga tayanadi — shuning uchun frontend
-- yangilanishlari deploy qilinishidan OLDIN bu fayl ishga tushirilgan
-- bo'lishi shart. Butun faylni bitta tranzaksiya sifatida bajarish
-- tavsiya etiladi (SQL Editor buni avtomatik BEGIN/COMMIT bilan o'raydi).
--
-- Talab qilinadigan mavjud jadvallar: firms, firm_members, contragents,
-- kassa, invoices (avvalgi FinanceHub UZ ilovasidan).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────
-- 1. YANGI JADVALLAR
-- ────────────────────────────────────────────────────────────

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('revenue','expense')),
  pnl_section TEXT NOT NULL CHECK (pnl_section IN ('revenue','cogs','opex','tax','interest')),
  cf_activity TEXT NOT NULL DEFAULT 'operating' CHECK (cf_activity IN ('operating','investing','financing')),
  direction TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (firm_id, name)
);

CREATE TABLE cash_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id),
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('naqd','bank','karta','elektron_hamyon','yoldagi_pul')),
  opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  opening_balance_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE financial_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id),
  category_id UUID NOT NULL REFERENCES categories(id),
  contragent_id UUID REFERENCES contragents(id),
  amount NUMERIC(18,2) NOT NULL,
  accrual_date DATE NOT NULL,
  due_date DATE,
  is_invoice BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid')),
  paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_fo_accrual ON financial_operations(firm_id, accrual_date);
CREATE INDEX idx_fo_firm_invoice ON financial_operations(firm_id, is_invoice);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES financial_operations(id) ON DELETE CASCADE,
  account_id UUID REFERENCES cash_accounts(id),
  amount NUMERIC(18,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method TEXT DEFAULT 'Naqd' CHECK (payment_method IN ('Naqd','Bank orqali','Karta orqali','Pul o''tkazma')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_payments_date ON payments(payment_date);
CREATE INDEX idx_payments_operation ON payments(operation_id);

CREATE TABLE account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id),
  from_account_id UUID REFERENCES cash_accounts(id),
  to_account_id UUID REFERENCES cash_accounts(id),
  amount NUMERIC(18,2) NOT NULL,
  sent_date DATE NOT NULL,
  received_date DATE,
  status TEXT DEFAULT 'in_transit' CHECK (status IN ('in_transit','completed')),
  note TEXT
);

CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id),
  direction TEXT NOT NULL CHECK (direction IN ('olingan','berilgan')),
  counterparty TEXT NOT NULL,
  principal_amount NUMERIC(18,2) NOT NULL,
  issue_date DATE NOT NULL,
  account_id UUID REFERENCES cash_accounts(id),
  note TEXT
);

CREATE TABLE loan_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount NUMERIC(18,2) NOT NULL,
  repayment_date DATE NOT NULL,
  account_id UUID REFERENCES cash_accounts(id)
);

CREATE TABLE credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id),
  lender_name TEXT NOT NULL,
  principal_amount NUMERIC(18,2) NOT NULL,
  interest_rate NUMERIC(5,2),
  issue_date DATE NOT NULL,
  account_id UUID REFERENCES cash_accounts(id)
);

CREATE TABLE credit_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id UUID NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
  amount NUMERIC(18,2) NOT NULL,
  payment_type TEXT CHECK (payment_type IN ('principal','interest')),
  payment_date DATE NOT NULL,
  account_id UUID REFERENCES cash_accounts(id)
);

CREATE TABLE dividends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id),
  recipient TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  payment_date DATE NOT NULL,
  account_id UUID REFERENCES cash_accounts(id)
);

CREATE TABLE investments_received (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id),
  investor_name TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  received_date DATE NOT NULL,
  account_id UUID REFERENCES cash_accounts(id)
);

CREATE TABLE fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id),
  name TEXT NOT NULL,
  purchase_value NUMERIC(18,2) NOT NULL,
  purchase_date DATE NOT NULL,
  useful_life_months INTEGER NOT NULL,
  disposal_date DATE,
  disposal_amount NUMERIC(18,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE capital_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id),
  type TEXT NOT NULL CHECK (type IN ('contribution','withdrawal')),
  amount NUMERIC(18,2) NOT NULL,
  entry_date DATE NOT NULL,
  note TEXT
);

-- ────────────────────────────────────────────────────────────
-- 2. TRIGGER — to'lov holatini avtomatik yangilash
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_operation_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  total_paid NUMERIC;
  op_amount NUMERIC;
  target_op UUID;
BEGIN
  target_op := COALESCE(NEW.operation_id, OLD.operation_id);

  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM payments WHERE operation_id = target_op;

  SELECT amount INTO op_amount
  FROM financial_operations WHERE id = target_op;

  UPDATE financial_operations
  SET paid_amount = total_paid,
      status = CASE
        WHEN total_paid <= 0 THEN 'unpaid'
        WHEN total_paid >= op_amount THEN 'paid'
        ELSE 'partial'
      END
  WHERE id = target_op;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_update
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION update_operation_payment_status();

-- ────────────────────────────────────────────────────────────
-- 3. RLS — firm_members orqali standart naqsh
--    (SELECT: har qanday a'zo; INSERT/UPDATE/DELETE: role_in_firm='buxgalter')
-- ────────────────────────────────────────────────────────────

-- 3.1. firm_id ustuni to'g'ridan-to'g'ri bor jadvallar
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories','cash_accounts','financial_operations','account_transfers',
    'loans','credits','dividends','investments_received','fixed_assets','capital_entries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format($f$
      CREATE POLICY %1$s_select ON %1$I FOR SELECT
      USING (firm_id IN (SELECT firm_id FROM firm_members WHERE user_id = auth.uid()))
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$s_insert ON %1$I FOR INSERT
      WITH CHECK (firm_id IN (SELECT firm_id FROM firm_members WHERE user_id = auth.uid() AND role_in_firm = 'buxgalter'))
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$s_update ON %1$I FOR UPDATE
      USING (firm_id IN (SELECT firm_id FROM firm_members WHERE user_id = auth.uid() AND role_in_firm = 'buxgalter'))
      WITH CHECK (firm_id IN (SELECT firm_id FROM firm_members WHERE user_id = auth.uid() AND role_in_firm = 'buxgalter'))
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$s_delete ON %1$I FOR DELETE
      USING (firm_id IN (SELECT firm_id FROM firm_members WHERE user_id = auth.uid() AND role_in_firm = 'buxgalter'))
    $f$, t);
  END LOOP;
END $$;

-- 3.2. firm_id'ga bola (child) jadvallar — ota jadval orqali tekshiriladi

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_select ON payments FOR SELECT
USING (EXISTS (
  SELECT 1 FROM financial_operations fo
  JOIN firm_members fm ON fm.firm_id = fo.firm_id
  WHERE fo.id = payments.operation_id AND fm.user_id = auth.uid()
));

CREATE POLICY payments_insert ON payments FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM financial_operations fo
  JOIN firm_members fm ON fm.firm_id = fo.firm_id
  WHERE fo.id = payments.operation_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
));

CREATE POLICY payments_update ON payments FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM financial_operations fo
  JOIN firm_members fm ON fm.firm_id = fo.firm_id
  WHERE fo.id = payments.operation_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
))
WITH CHECK (EXISTS (
  SELECT 1 FROM financial_operations fo
  JOIN firm_members fm ON fm.firm_id = fo.firm_id
  WHERE fo.id = payments.operation_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
));

CREATE POLICY payments_delete ON payments FOR DELETE
USING (EXISTS (
  SELECT 1 FROM financial_operations fo
  JOIN firm_members fm ON fm.firm_id = fo.firm_id
  WHERE fo.id = payments.operation_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
));

ALTER TABLE loan_repayments ENABLE ROW LEVEL SECURITY;

CREATE POLICY loan_repayments_select ON loan_repayments FOR SELECT
USING (EXISTS (
  SELECT 1 FROM loans l JOIN firm_members fm ON fm.firm_id = l.firm_id
  WHERE l.id = loan_repayments.loan_id AND fm.user_id = auth.uid()
));

CREATE POLICY loan_repayments_insert ON loan_repayments FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM loans l JOIN firm_members fm ON fm.firm_id = l.firm_id
  WHERE l.id = loan_repayments.loan_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
));

CREATE POLICY loan_repayments_update ON loan_repayments FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM loans l JOIN firm_members fm ON fm.firm_id = l.firm_id
  WHERE l.id = loan_repayments.loan_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
))
WITH CHECK (EXISTS (
  SELECT 1 FROM loans l JOIN firm_members fm ON fm.firm_id = l.firm_id
  WHERE l.id = loan_repayments.loan_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
));

CREATE POLICY loan_repayments_delete ON loan_repayments FOR DELETE
USING (EXISTS (
  SELECT 1 FROM loans l JOIN firm_members fm ON fm.firm_id = l.firm_id
  WHERE l.id = loan_repayments.loan_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
));

ALTER TABLE credit_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_payments_select ON credit_payments FOR SELECT
USING (EXISTS (
  SELECT 1 FROM credits cr JOIN firm_members fm ON fm.firm_id = cr.firm_id
  WHERE cr.id = credit_payments.credit_id AND fm.user_id = auth.uid()
));

CREATE POLICY credit_payments_insert ON credit_payments FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM credits cr JOIN firm_members fm ON fm.firm_id = cr.firm_id
  WHERE cr.id = credit_payments.credit_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
));

CREATE POLICY credit_payments_update ON credit_payments FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM credits cr JOIN firm_members fm ON fm.firm_id = cr.firm_id
  WHERE cr.id = credit_payments.credit_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
))
WITH CHECK (EXISTS (
  SELECT 1 FROM credits cr JOIN firm_members fm ON fm.firm_id = cr.firm_id
  WHERE cr.id = credit_payments.credit_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
));

CREATE POLICY credit_payments_delete ON credit_payments FOR DELETE
USING (EXISTS (
  SELECT 1 FROM credits cr JOIN firm_members fm ON fm.firm_id = cr.firm_id
  WHERE cr.id = credit_payments.credit_id AND fm.user_id = auth.uid() AND fm.role_in_firm = 'buxgalter'
));

-- ────────────────────────────────────────────────────────────
-- 4. GENERIK KATEGORIYALAR SEED (har mavjud firma uchun)
--    Hozirgi ilovadagi CATEGORIES konstantasi (app.js) asosida.
-- ────────────────────────────────────────────────────────────

INSERT INTO categories (firm_id, name, type, pnl_section, cf_activity)
SELECT f.id, v.name, v.type, v.pnl_section, v.cf_activity
FROM firms f
CROSS JOIN (VALUES
  ('Mijoz to''lovi',         'revenue', 'revenue', 'operating'),
  ('Obuna to''lovi',         'revenue', 'revenue', 'operating'),
  ('Xizmat haqi',            'revenue', 'revenue', 'operating'),
  ('Savdo',                  'revenue', 'revenue', 'operating'),
  ('Investitsiya daromadi',  'revenue', 'revenue', 'investing'),
  ('Boshqa kirim',           'revenue', 'revenue', 'operating'),
  ('Ijara',                  'expense', 'opex',    'operating'),
  ('Ish haqi',               'expense', 'opex',    'operating'),
  ('Kommunal to''lovlar',    'expense', 'opex',    'operating'),
  ('Transport',              'expense', 'opex',    'operating'),
  ('Marketing',               'expense', 'opex',    'operating'),
  ('Jihozlar',               'expense', 'opex',    'operating'),
  ('Soliqlar',               'expense', 'tax',     'operating'),
  ('Boshqa xarajat',         'expense', 'opex',    'operating')
) AS v(name, type, pnl_section, cf_activity);

-- ────────────────────────────────────────────────────────────
-- 5. STANDART KASSA HISOBI (har firma uchun "Naqd")
-- ────────────────────────────────────────────────────────────

INSERT INTO cash_accounts (firm_id, name, account_type, opening_balance, opening_balance_date)
SELECT id, 'Naqd', 'naqd', 0, CURRENT_DATE
FROM firms;

-- ────────────────────────────────────────────────────────────
-- 6. BACKFILL — eski `kassa` jadvalidan
-- ────────────────────────────────────────────────────────────

ALTER TABLE financial_operations ADD COLUMN legacy_kassa_id UUID;

INSERT INTO financial_operations
  (firm_id, category_id, contragent_id, amount, accrual_date, is_invoice, status, paid_amount, description, legacy_kassa_id)
SELECT
  k.firm_id,
  COALESCE(c.id, cf.id) AS category_id,
  k.contragent_id,
  k.amount,
  k.date,
  false,
  'paid',
  k.amount,
  k.note,
  k.id
FROM kassa k
LEFT JOIN categories c ON c.firm_id = k.firm_id AND c.name = k.category
LEFT JOIN categories cf ON cf.firm_id = k.firm_id
  AND cf.name = CASE WHEN k.type = 'Kirim' THEN 'Boshqa kirim' ELSE 'Boshqa xarajat' END;

INSERT INTO payments (operation_id, amount, payment_date, payment_method, account_id)
SELECT fo.id, k.amount, k.date, k.method, ca.id
FROM financial_operations fo
JOIN kassa k ON k.id = fo.legacy_kassa_id
JOIN cash_accounts ca ON ca.firm_id = fo.firm_id AND ca.name = 'Naqd';

ALTER TABLE financial_operations DROP COLUMN legacy_kassa_id;

-- ────────────────────────────────────────────────────────────
-- 7. BACKFILL — eski `invoices` jadvalidan
-- ────────────────────────────────────────────────────────────

ALTER TABLE financial_operations ADD COLUMN legacy_invoice_id UUID;

INSERT INTO financial_operations
  (firm_id, category_id, contragent_id, amount, accrual_date, due_date, is_invoice, status, paid_amount, description, legacy_invoice_id)
SELECT
  i.firm_id,
  cat.id,
  i.contragent_id,
  i.amount,
  i.date,
  i.due_date,
  true,
  CASE WHEN i.status = 'To''langan' THEN 'paid' ELSE 'unpaid' END,
  CASE WHEN i.status = 'To''langan' THEN i.amount ELSE 0 END,
  COALESCE(i.number, '') || CASE WHEN i.description IS NOT NULL AND i.description <> '' THEN ' — ' || i.description ELSE '' END,
  i.id
FROM invoices i
JOIN categories cat ON cat.firm_id = i.firm_id AND cat.name = 'Mijoz to''lovi';

INSERT INTO payments (operation_id, amount, payment_date, payment_method, account_id)
SELECT fo.id, i.amount, i.date, 'Bank orqali', ca.id
FROM financial_operations fo
JOIN invoices i ON i.id = fo.legacy_invoice_id
JOIN cash_accounts ca ON ca.firm_id = fo.firm_id AND ca.name = 'Naqd'
WHERE i.status = 'To''langan';

ALTER TABLE financial_operations DROP COLUMN legacy_invoice_id;

-- ────────────────────────────────────────────────────────────
-- Tugadi. Tekshirish uchun:
--   SELECT count(*) FROM categories;
--   SELECT count(*) FROM financial_operations;
--   SELECT count(*) FROM payments;
--   SELECT count(*) FROM cash_accounts;
-- ────────────────────────────────────────────────────────────

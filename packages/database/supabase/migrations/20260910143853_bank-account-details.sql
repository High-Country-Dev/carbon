-- Bank account details for the company itself, for suppliers and for customers.
--
-- Three tables, one shape. `bankAccount` is the company's own account, linked 1:1 to
-- the GL account its cash posts through. `supplierBankAccount` and `customerBankAccount`
-- are the counterparty destinations; their business fields are immutable by design (see
-- the versioning note below).
--
-- Country-specific identifiers are NOT modelled as one column per country. Every format
-- has at most one primary domestic clearing code, which lands in "routingNumber" —
-- ABA routing number in the US, sort code in GB, BSB in AU, generic bank code elsewhere.
-- The label and validation come from the format registry in
-- packages/utils/src/bank-formats.ts, keyed by the "formatId" stored on the row.
-- Secondary parts (US account type, CA institution number, branch codes) go in
-- "bankIdentifiers" JSONB, so supporting a new country is a change to that registry with
-- no migration.
--
-- Account numbers and IBANs are secret: the row holds a Supabase Vault reference plus a
-- last-four display value, never the value itself. Same mechanism as integration
-- credentials (20260817122916_integration-secret-vault.sql, NIST 800-171 3.13.16).
--
-- Versioning (supplier and customer only): a create, an edit and a deactivation each
-- INSERT a new row; the superseded row is stamped Inactive with an "effectiveTo". These
-- two tables deliberately have NO UPDATE and NO DELETE policy, so business fields are
-- immutable against PostgREST and not merely against the UI — supplier bank detail
-- changes are the classic payment-fraud vector. Transitions run through service-role
-- Kysely inside one transaction. With no approval rule configured a proposed row
-- activates immediately, which is the shape .ai/specs/2026-07-04-master-data-controls.md
-- specifies for the no-rule case, so the approval gate lands later as a pure addition.
--
-- NOTE for .ai/specs/2026-07-02-bank-reconciliation.md: `bankAccount` exists as of this
-- migration, so that spec's `CREATE TABLE IF NOT EXISTS "bankAccount"` will silently skip.
-- Its Plaid/feed columns (source, plaidItemId, plaidAccountId, connectionStatus,
-- lastSyncedAt, openingBalance, openingDate) must be added with ALTER TABLE.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  -- Shared by supplierBankAccount and customerBankAccount.
  CREATE TYPE "bankAccountStatus" AS ENUM ('Pending Approval', 'Active', 'Rejected', 'Inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "bankAccountChangeType" AS ENUM ('Create', 'Update', 'Deactivate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Recorded, never gating. Written by no code in this migration's feature set; the
  -- callback-verification control that populates it is owned by the master-data-controls spec.
  CREATE TYPE "bankVerificationMethod" AS ENUM ('Callback', 'Bank Letter', 'Micro-deposit', 'Counterparty Portal', 'Other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- bankAccount — the company's own accounts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "bankAccount" (
  "id" TEXT NOT NULL DEFAULT id('bka'),
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "glAccountId" TEXT NOT NULL,
  "bankName" TEXT,
  "accountHolderName" TEXT,
  "countryCode" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  -- Which entry in the bank-format registry produced this row. Stored rather than
  -- re-derived from countryCode so a later registry change cannot reinterpret history.
  "formatId" TEXT NOT NULL,
  "swiftBic" TEXT,
  -- The primary domestic clearing code for this account's country; the registry names it.
  "routingNumber" TEXT,
  -- Secondary country-specific identifiers, keyed by registry field key.
  "bankIdentifiers" JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Vault secret id for the {accountNumber, iban} bag. Never the values themselves.
  "secretRef" TEXT,
  "accountNumberLastFour" TEXT,
  "ibanLastFour" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "bankAccount_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "bankAccount_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- GL accounts are company-group scoped, so this is a plain id reference; uniqueness
  -- is enforced per company below.
  CONSTRAINT "bankAccount_glAccountId_fkey" FOREIGN KEY ("glAccountId")
    REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bankAccount_countryCode_fkey" FOREIGN KEY ("countryCode")
    REFERENCES "country"("alpha2") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bankAccount_currencyCode_fkey" FOREIGN KEY ("currencyCode")
    REFERENCES "currencyCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bankAccount_name_key" UNIQUE ("name", "companyId"),
  -- A row that identifies no account is not a bank account.
  CONSTRAINT "bankAccount_identifier_check" CHECK (
    "accountNumberLastFour" IS NOT NULL OR "ibanLastFour" IS NOT NULL
  )
);

-- One bank account per GL account: two bank accounts sharing GL lines cannot be
-- reconciled apart. Matches the bank-reconciliation spec's constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "bankAccount_glAccountId_idx"
  ON "bankAccount" ("glAccountId", "companyId");
CREATE INDEX IF NOT EXISTS "bankAccount_companyId_idx" ON "bankAccount" ("companyId");
CREATE INDEX IF NOT EXISTS "bankAccount_createdBy_idx" ON "bankAccount" ("createdBy");
CREATE INDEX IF NOT EXISTS "bankAccount_updatedBy_idx" ON "bankAccount" ("updatedBy");

ALTER TABLE "public"."bankAccount" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."bankAccount";
CREATE POLICY "SELECT" ON "public"."bankAccount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."bankAccount";
CREATE POLICY "INSERT" ON "public"."bankAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."bankAccount";
CREATE POLICY "UPDATE" ON "public"."bankAccount"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

DROP POLICY IF EXISTS "DELETE" ON "public"."bankAccount";
CREATE POLICY "DELETE" ON "public"."bankAccount"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);

-- ---------------------------------------------------------------------------
-- supplierBankAccount — where we pay a supplier
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "supplierBankAccount" (
  "id" TEXT NOT NULL DEFAULT id('sba'),
  "companyId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "status" "bankAccountStatus" NOT NULL DEFAULT 'Active',
  "changeType" "bankAccountChangeType" NOT NULL DEFAULT 'Create',
  -- The prior version this row supersedes.
  "replacesId" TEXT,
  "name" TEXT NOT NULL,
  "bankName" TEXT,
  "accountHolderName" TEXT,
  "countryCode" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "formatId" TEXT NOT NULL,
  "swiftBic" TEXT,
  "routingNumber" TEXT,
  "bankIdentifiers" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "secretRef" TEXT,
  "accountNumberLastFour" TEXT,
  "ibanLastFour" TEXT,
  "effectiveFrom" TIMESTAMP WITH TIME ZONE,
  "effectiveTo" TIMESTAMP WITH TIME ZONE,
  -- Verification is a record of the procedural callback control, not a gate. Reset to
  -- NULL on every new version so verified status cannot be laundered through an edit.
  "verifiedBy" TEXT REFERENCES "user"("id"),
  "verifiedAt" TIMESTAMP WITH TIME ZONE,
  "verificationMethod" "bankVerificationMethod",
  "verificationNotes" TEXT,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "supplierBankAccount_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "supplierBankAccount_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplierBankAccount_supplierId_fkey" FOREIGN KEY ("supplierId")
    REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplierBankAccount_replacesId_fkey" FOREIGN KEY ("replacesId", "companyId")
    REFERENCES "supplierBankAccount"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierBankAccount_countryCode_fkey" FOREIGN KEY ("countryCode")
    REFERENCES "country"("alpha2") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierBankAccount_currencyCode_fkey" FOREIGN KEY ("currencyCode")
    REFERENCES "currencyCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- A deactivation row carries no identifiers; every other row must identify an account.
  CONSTRAINT "supplierBankAccount_identifier_check" CHECK (
    "changeType" = 'Deactivate'
    OR "accountNumberLastFour" IS NOT NULL
    OR "ibanLastFour" IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS "supplierBankAccount_supplierId_idx"
  ON "supplierBankAccount" ("supplierId", "companyId");
CREATE INDEX IF NOT EXISTS "supplierBankAccount_status_idx"
  ON "supplierBankAccount" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "supplierBankAccount_companyId_idx" ON "supplierBankAccount" ("companyId");
CREATE INDEX IF NOT EXISTS "supplierBankAccount_replacesId_idx" ON "supplierBankAccount" ("replacesId");
CREATE INDEX IF NOT EXISTS "supplierBankAccount_createdBy_idx" ON "supplierBankAccount" ("createdBy");
CREATE INDEX IF NOT EXISTS "supplierBankAccount_updatedBy_idx" ON "supplierBankAccount" ("updatedBy");
CREATE INDEX IF NOT EXISTS "supplierBankAccount_verifiedBy_idx" ON "supplierBankAccount" ("verifiedBy");

-- One in-flight pending change per supplier, so competing edits serialize instead of
-- racing. Inert until an approval rule exists, and free to carry now.
CREATE UNIQUE INDEX IF NOT EXISTS "supplierBankAccount_pending_idx"
  ON "supplierBankAccount" ("supplierId", "companyId")
  WHERE "status" = 'Pending Approval';

ALTER TABLE "public"."supplierBankAccount" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."supplierBankAccount";
CREATE POLICY "SELECT" ON "public"."supplierBankAccount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."supplierBankAccount";
CREATE POLICY "INSERT" ON "public"."supplierBankAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);

-- Deliberately no UPDATE and no DELETE policy. Business fields are immutable; status
-- transitions and verification stamps run through service-role Kysely only.

-- ---------------------------------------------------------------------------
-- customerBankAccount — where a customer pays from
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "customerBankAccount" (
  "id" TEXT NOT NULL DEFAULT id('cba'),
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "bankAccountStatus" NOT NULL DEFAULT 'Active',
  "changeType" "bankAccountChangeType" NOT NULL DEFAULT 'Create',
  "replacesId" TEXT,
  "name" TEXT NOT NULL,
  "bankName" TEXT,
  "accountHolderName" TEXT,
  "countryCode" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "formatId" TEXT NOT NULL,
  "swiftBic" TEXT,
  "routingNumber" TEXT,
  "bankIdentifiers" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "secretRef" TEXT,
  "accountNumberLastFour" TEXT,
  "ibanLastFour" TEXT,
  "effectiveFrom" TIMESTAMP WITH TIME ZONE,
  "effectiveTo" TIMESTAMP WITH TIME ZONE,
  "verifiedBy" TEXT REFERENCES "user"("id"),
  "verifiedAt" TIMESTAMP WITH TIME ZONE,
  "verificationMethod" "bankVerificationMethod",
  "verificationNotes" TEXT,
  "customFields" JSONB,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "customerBankAccount_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerBankAccount_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerBankAccount_customerId_fkey" FOREIGN KEY ("customerId")
    REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerBankAccount_replacesId_fkey" FOREIGN KEY ("replacesId", "companyId")
    REFERENCES "customerBankAccount"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customerBankAccount_countryCode_fkey" FOREIGN KEY ("countryCode")
    REFERENCES "country"("alpha2") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customerBankAccount_currencyCode_fkey" FOREIGN KEY ("currencyCode")
    REFERENCES "currencyCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customerBankAccount_identifier_check" CHECK (
    "changeType" = 'Deactivate'
    OR "accountNumberLastFour" IS NOT NULL
    OR "ibanLastFour" IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS "customerBankAccount_customerId_idx"
  ON "customerBankAccount" ("customerId", "companyId");
CREATE INDEX IF NOT EXISTS "customerBankAccount_status_idx"
  ON "customerBankAccount" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "customerBankAccount_companyId_idx" ON "customerBankAccount" ("companyId");
CREATE INDEX IF NOT EXISTS "customerBankAccount_replacesId_idx" ON "customerBankAccount" ("replacesId");
CREATE INDEX IF NOT EXISTS "customerBankAccount_createdBy_idx" ON "customerBankAccount" ("createdBy");
CREATE INDEX IF NOT EXISTS "customerBankAccount_updatedBy_idx" ON "customerBankAccount" ("updatedBy");
CREATE INDEX IF NOT EXISTS "customerBankAccount_verifiedBy_idx" ON "customerBankAccount" ("verifiedBy");

CREATE UNIQUE INDEX IF NOT EXISTS "customerBankAccount_pending_idx"
  ON "customerBankAccount" ("customerId", "companyId")
  WHERE "status" = 'Pending Approval';

ALTER TABLE "public"."customerBankAccount" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."customerBankAccount";
CREATE POLICY "SELECT" ON "public"."customerBankAccount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."customerBankAccount";
CREATE POLICY "INSERT" ON "public"."customerBankAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);

-- Deliberately no UPDATE and no DELETE policy. See supplierBankAccount above.

-- ---------------------------------------------------------------------------
-- Vault: account numbers and IBANs
-- ---------------------------------------------------------------------------
-- Mirrors 20260817122916_integration-secret-vault.sql. The vault schema is not exposed
-- to PostgREST, so every access goes through these SECURITY DEFINER functions, granted
-- to service_role only — no anon/authenticated client can decrypt a bank account number.
-- p_scope selects the owning table; anything else raises rather than silently no-op.

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault CASCADE;

CREATE OR REPLACE FUNCTION bank_account_secret_table(p_scope text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  CASE p_scope
    WHEN 'company'  THEN RETURN 'bankAccount';
    WHEN 'supplier' THEN RETURN 'supplierBankAccount';
    WHEN 'customer' THEN RETURN 'customerBankAccount';
    ELSE RAISE EXCEPTION 'unknown bank account scope: %', p_scope;
  END CASE;
END;
$$;

-- Upsert the {accountNumber, iban} bag for one row and stamp the vault id back onto it.
CREATE OR REPLACE FUNCTION upsert_bank_account_secret(
  p_company_id text, p_scope text, p_record_id text, p_secret jsonb
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_table text := bank_account_secret_table(p_scope);
  v_name text := 'bank:' || p_scope || ':' || p_company_id || ':' || p_record_id;
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    v_id := vault.create_secret(p_secret::text, v_name, 'Carbon bank account secret');
  ELSE
    -- Vault restricts direct UPDATE on vault.secrets; use the supported function.
    PERFORM vault.update_secret(v_id, p_secret::text);
  END IF;
  EXECUTE format(
    'UPDATE %I SET "secretRef" = $1 WHERE "id" = $2 AND "companyId" = $3', v_table
  ) USING v_id::text, p_record_id, p_company_id;
  RETURN v_id::text;
END;
$$;

CREATE OR REPLACE FUNCTION get_bank_account_secret(
  p_company_id text, p_scope text, p_record_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_table text := bank_account_secret_table(p_scope);
  v_ref text;
  v_secret text;
BEGIN
  EXECUTE format(
    'SELECT "secretRef" FROM %I WHERE "id" = $1 AND "companyId" = $2', v_table
  ) INTO v_ref USING p_record_id, p_company_id;
  IF v_ref IS NULL THEN RETURN NULL; END IF;  -- caller fails closed
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = v_ref::uuid;
  IF v_secret IS NULL THEN RETURN NULL; END IF;
  RETURN v_secret::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION delete_bank_account_secret(
  p_company_id text, p_scope text, p_record_id text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  DELETE FROM vault.secrets
    WHERE name = 'bank:' || p_scope || ':' || p_company_id || ':' || p_record_id;
END;
$$;

REVOKE ALL ON FUNCTION upsert_bank_account_secret(text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_bank_account_secret(text,text,text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delete_bank_account_secret(text,text,text)       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_bank_account_secret(text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION get_bank_account_secret(text,text,text)          TO service_role;
GRANT EXECUTE ON FUNCTION delete_bank_account_secret(text,text,text)       TO service_role;

-- vault.secrets does not cascade on its own. A deleted company bank account, or a
-- supplier/customer bank row removed by its parent's cascade, takes its secret with it.
CREATE OR REPLACE FUNCTION drop_bank_account_secret_on_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  DELETE FROM vault.secrets
    WHERE name = 'bank:' || TG_ARGV[0] || ':' || OLD."companyId" || ':' || OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_drop_bank_account_secret ON "bankAccount";
CREATE TRIGGER trg_drop_bank_account_secret
  AFTER DELETE ON "bankAccount"
  FOR EACH ROW EXECUTE FUNCTION drop_bank_account_secret_on_delete('company');

DROP TRIGGER IF EXISTS trg_drop_supplier_bank_account_secret ON "supplierBankAccount";
CREATE TRIGGER trg_drop_supplier_bank_account_secret
  AFTER DELETE ON "supplierBankAccount"
  FOR EACH ROW EXECUTE FUNCTION drop_bank_account_secret_on_delete('supplier');

DROP TRIGGER IF EXISTS trg_drop_customer_bank_account_secret ON "customerBankAccount";
CREATE TRIGGER trg_drop_customer_bank_account_secret
  AFTER DELETE ON "customerBankAccount"
  FOR EACH ROW EXECUTE FUNCTION drop_bank_account_secret_on_delete('customer');

-- ---------------------------------------------------------------------------
-- Custom fields registry
-- ---------------------------------------------------------------------------

INSERT INTO "customFieldTable" ("table", "name", "module") VALUES
  ('bankAccount', 'Bank Account', 'Accounting'),
  ('supplierBankAccount', 'Supplier Bank Account', 'Purchasing'),
  ('customerBankAccount', 'Customer Bank Account', 'Sales')
ON CONFLICT ("table") DO NOTHING;

NOTIFY pgrst, 'reload schema';

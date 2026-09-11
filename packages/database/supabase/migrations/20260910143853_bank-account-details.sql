-- Bank account details for the company itself, for suppliers and for customers.
--
-- Three tables, one shape: a thin spine of columns every account has regardless of where
-- it is held, plus a "fields" bag holding the identifiers themselves.
--
-- The bag is an ordered JSONB array of {key, label, value} objects:
--
--   [{"key": "iban",     "label": "IBAN",        "value": "DE89370400440532013000"},
--    {"key": "swiftBic", "label": "SWIFT / BIC", "value": "COBADEFFXXX"}]
--
-- Keys are NOT constrained. Carbon seeds a catalog of the identifiers banks actually use
-- (packages/utils/src/bank-fields.ts) and the form offers them in a combobox ordered by
-- the account's country, but a user can type a key of their own for a bank, a corridor or
-- a jurisdiction Carbon has never heard of. Supporting a new country is therefore data
-- entry, not a migration, and not even a code change unless we want the suggestion.
--
-- Consequence, deliberate: nothing here knows which entry is the account number. That is
-- correct for this migration, whose whole job is configuration — nothing reads these rows.
-- The payment surfaces that eventually do will need a stable key for the two or three
-- fields a payment file requires, and that is the point at which some of this becomes
-- fixed. It is cheap to fix later and expensive to over-fix now.
--
-- Values are stored in plain text. See the note in
-- .ai/specs/2026-09-10-bank-account-details.md — this is an open item for the team, not a
-- settled position. Moving the sensitive entries into Supabase Vault later is a change to
-- the write path plus a backfill; the row shape does not change.
--
-- NOTE for .ai/specs/2026-07-02-bank-reconciliation.md: `bankAccount` exists as of this
-- migration, so that spec's `CREATE TABLE IF NOT EXISTS "bankAccount"` will silently skip.
-- Its Plaid/feed columns (source, plaidItemId, plaidAccountId, connectionStatus,
-- lastSyncedAt, openingBalance, openingDate) must be added with ALTER TABLE.

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
  -- Ordered [{key, label, value}]; see the header.
  "fields" JSONB NOT NULL DEFAULT '[]'::jsonb,
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
  -- An object would read as valid JSONB and break every consumer silently.
  CONSTRAINT "bankAccount_fields_check" CHECK (jsonb_typeof("fields") = 'array')
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
  "name" TEXT NOT NULL,
  "bankName" TEXT,
  "accountHolderName" TEXT,
  "countryCode" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "fields" JSONB NOT NULL DEFAULT '[]'::jsonb,
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
  CONSTRAINT "supplierBankAccount_countryCode_fkey" FOREIGN KEY ("countryCode")
    REFERENCES "country"("alpha2") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierBankAccount_currencyCode_fkey" FOREIGN KEY ("currencyCode")
    REFERENCES "currencyCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplierBankAccount_fields_check" CHECK (jsonb_typeof("fields") = 'array')
);

CREATE INDEX IF NOT EXISTS "supplierBankAccount_supplierId_idx"
  ON "supplierBankAccount" ("supplierId", "companyId");
CREATE INDEX IF NOT EXISTS "supplierBankAccount_companyId_idx" ON "supplierBankAccount" ("companyId");
CREATE INDEX IF NOT EXISTS "supplierBankAccount_createdBy_idx" ON "supplierBankAccount" ("createdBy");
CREATE INDEX IF NOT EXISTS "supplierBankAccount_updatedBy_idx" ON "supplierBankAccount" ("updatedBy");

ALTER TABLE "public"."supplierBankAccount" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."supplierBankAccount";
CREATE POLICY "SELECT" ON "public"."supplierBankAccount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."supplierBankAccount";
CREATE POLICY "INSERT" ON "public"."supplierBankAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."supplierBankAccount";
CREATE POLICY "UPDATE" ON "public"."supplierBankAccount"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);

DROP POLICY IF EXISTS "DELETE" ON "public"."supplierBankAccount";
CREATE POLICY "DELETE" ON "public"."supplierBankAccount"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[])
);

-- ---------------------------------------------------------------------------
-- customerBankAccount — where a customer pays from
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "customerBankAccount" (
  "id" TEXT NOT NULL DEFAULT id('cba'),
  "companyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "bankName" TEXT,
  "accountHolderName" TEXT,
  "countryCode" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "fields" JSONB NOT NULL DEFAULT '[]'::jsonb,
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
  CONSTRAINT "customerBankAccount_countryCode_fkey" FOREIGN KEY ("countryCode")
    REFERENCES "country"("alpha2") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customerBankAccount_currencyCode_fkey" FOREIGN KEY ("currencyCode")
    REFERENCES "currencyCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customerBankAccount_fields_check" CHECK (jsonb_typeof("fields") = 'array')
);

CREATE INDEX IF NOT EXISTS "customerBankAccount_customerId_idx"
  ON "customerBankAccount" ("customerId", "companyId");
CREATE INDEX IF NOT EXISTS "customerBankAccount_companyId_idx" ON "customerBankAccount" ("companyId");
CREATE INDEX IF NOT EXISTS "customerBankAccount_createdBy_idx" ON "customerBankAccount" ("createdBy");
CREATE INDEX IF NOT EXISTS "customerBankAccount_updatedBy_idx" ON "customerBankAccount" ("updatedBy");

ALTER TABLE "public"."customerBankAccount" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."customerBankAccount";
CREATE POLICY "SELECT" ON "public"."customerBankAccount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
);

DROP POLICY IF EXISTS "INSERT" ON "public"."customerBankAccount";
CREATE POLICY "INSERT" ON "public"."customerBankAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."customerBankAccount";
CREATE POLICY "UPDATE" ON "public"."customerBankAccount"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);

DROP POLICY IF EXISTS "DELETE" ON "public"."customerBankAccount";
CREATE POLICY "DELETE" ON "public"."customerBankAccount"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

-- ---------------------------------------------------------------------------
-- Custom fields registry
-- ---------------------------------------------------------------------------
-- The "fields" bag covers per-account identifiers. These registry rows are the
-- per-company structured extension, which is a different thing: a field every account of
-- this company has.

INSERT INTO "customFieldTable" ("table", "name", "module") VALUES
  ('bankAccount', 'Bank Account', 'Accounting'),
  ('supplierBankAccount', 'Supplier Bank Account', 'Purchasing'),
  ('customerBankAccount', 'Customer Bank Account', 'Sales')
ON CONFLICT ("table") DO NOTHING;

NOTIFY pgrst, 'reload schema';

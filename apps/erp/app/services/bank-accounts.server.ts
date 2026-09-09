/**
 * Bank account secrets (NIST 800-171 3.13.16 / SC-28).
 *
 * Account numbers and IBANs are encrypted at rest in Supabase Vault; the row keeps only a
 * `secretRef` pointer and a last-four for display. The vault schema is not exposed to
 * PostgREST, so every access goes through the SECURITY DEFINER RPCs added in the
 * bank-account-details migration — always with a service-role client. An anon or
 * authenticated client cannot decrypt a bank account number.
 *
 * Server-only. This module must never be re-exported from a module barrel: the barrels are
 * imported by client components, and a service-role client in the browser bundle is a
 * tenant-isolation failure.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";

/** Which table owns the record, and therefore which vault secret name is used. */
export type BankAccountScope = "company" | "supplier" | "customer";

export type BankAccountSecrets = {
  accountNumber?: string;
  iban?: string;
};

/** Thrown when a secret is expected in the vault but cannot be read (fail-closed). */
export class BankAccountSecretUnavailableError extends Error {
  constructor(scope: BankAccountScope, recordId: string) {
    super(`Bank account secret unavailable for ${scope} record ${recordId}`);
    this.name = "BankAccountSecretUnavailableError";
  }
}

/**
 * Write the `{accountNumber, iban}` bag for one row and stamp the vault id onto it.
 *
 * Call this AFTER the row exists — the RPC keys the secret on the row's id and updates
 * `secretRef` in place. A caller that cannot recover from a failure here should delete the
 * row it just inserted rather than leave one whose identifiers cannot be read back.
 */
export async function writeBankAccountSecret(
  companyId: string,
  scope: BankAccountScope,
  recordId: string,
  secrets: BankAccountSecrets
) {
  const payload = Object.fromEntries(
    Object.entries(secrets).filter(([, value]) => Boolean(value))
  );

  if (Object.keys(payload).length === 0) {
    return { data: null, error: null };
  }

  return getCarbonServiceRole().rpc("upsert_bank_account_secret", {
    p_company_id: companyId,
    p_scope: scope,
    p_record_id: recordId,
    p_secret: payload as never
  });
}

/**
 * Read the decrypted identifiers for one row.
 *
 * No route exposes this. Its intended consumer is payment execution — a payment file needs
 * the full account number, and nothing else does. Fails closed: a row whose secret cannot
 * be read raises rather than returning a partially populated account.
 */
export async function readBankAccountSecret(
  companyId: string,
  scope: BankAccountScope,
  recordId: string
): Promise<BankAccountSecrets> {
  const { data, error } = await getCarbonServiceRole().rpc(
    "get_bank_account_secret",
    {
      p_company_id: companyId,
      p_scope: scope,
      p_record_id: recordId
    }
  );

  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new BankAccountSecretUnavailableError(scope, recordId);
  }

  return data as BankAccountSecrets;
}

/**
 * Copy a row's secrets onto a new row. Editing a supplier or customer bank account creates
 * a new version; when the user leaves a masked field untouched, the stored value has to
 * travel to the new row rather than be lost or re-typed.
 */
export async function copyBankAccountSecret(
  companyId: string,
  scope: BankAccountScope,
  fromRecordId: string,
  toRecordId: string,
  overrides: BankAccountSecrets = {}
) {
  const existing = await readBankAccountSecret(companyId, scope, fromRecordId);
  return writeBankAccountSecret(companyId, scope, toRecordId, {
    ...existing,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => Boolean(value))
    )
  });
}

/**
 * Drop a row's secret. Row deletion already drops it via an AFTER DELETE trigger; this is
 * for the rollback path, where a row is removed after its secret was written.
 */
export async function deleteBankAccountSecret(
  companyId: string,
  scope: BankAccountScope,
  recordId: string
) {
  return getCarbonServiceRole().rpc("delete_bank_account_secret", {
    p_company_id: companyId,
    p_scope: scope,
    p_record_id: recordId
  });
}

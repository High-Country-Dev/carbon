import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { CustomFormFields, Hidden, Input, Submit } from "~/components/Form";
import BankAccountFields from "~/components/Form/BankAccountFields";
import { usePermissions } from "~/hooks";
import { supplierBankAccountValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierBankAccountFormProps = {
  supplierId: string;
  initialValues: z.infer<typeof supplierBankAccountValidator>;
  /** Last four of the identifiers already stored, so the inputs can render a mask. */
  storedLastFour?: {
    accountNumber?: string | null;
    iban?: string | null;
  };
  onClose: () => void;
};

/**
 * Saving an edit here does not update the record — it inserts a new version and retires
 * the old one, because `supplierBankAccount` has no UPDATE policy. `initialValues.id` is
 * therefore the version being superseded, not a row to write over.
 */
const SupplierBankAccountForm = ({
  supplierId,
  initialValues,
  storedLastFour,
  onClose
}: SupplierBankAccountFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  // Submit through a fetcher, like every other drawer form: a plain navigation submit
  // races the Submit button's unsaved-changes blocker, which sees the action's redirect
  // as "leaving with unsaved changes" and swallows the save.
  const fetcher = useFetcher();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = !permissions.can("update", "purchasing");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={supplierBankAccountValidator}
            method="post"
            action={
              isEditing
                ? path.to.supplierBankAccount(supplierId, initialValues.id!)
                : path.to.newSupplierBankAccount(supplierId)
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Bank Account</Trans>
                ) : (
                  <Trans>New Bank Account</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input
                  name="name"
                  label={t`Name`}
                  helperText={t`What to call this account, e.g. "Operating — USD".`}
                />
                <BankAccountFields storedLastFour={storedLastFour} />
                <CustomFormFields table="supplierBankAccount" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default SupplierBankAccountForm;

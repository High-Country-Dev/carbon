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
import type { BankFieldEntry } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Account,
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import BankAccountFields from "~/components/Form/BankAccountFields";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { bankAccountValidator } from "../../accounting.models";
import { bankAccountValidator as validator } from "../../accounting.models";

type BankAccountFormProps = {
  initialValues: z.infer<typeof bankAccountValidator>;
  /** The bag already stored, when editing. */
  storedFields?: BankFieldEntry[];
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const BankAccountForm = ({
  initialValues,
  storedFields,
  open = true,
  type = "drawer",
  onClose
}: BankAccountFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  // Submit through a fetcher, like every other drawer form: a plain navigation submit
  // races the Submit button's unsaved-changes blocker, which sees the action's redirect
  // as "leaving with unsaved changes" and swallows the save.
  const fetcher = useFetcher();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={validator}
            method="post"
            action={
              isEditing
                ? path.to.bankAccount(initialValues.id!)
                : path.to.newBankAccount
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
                <Input name="name" label={t`Name`} />
                {/* One bank account per GL account, so cash can be reconciled per bank. */}
                <Account
                  name="glAccountId"
                  label={t`GL Account`}
                  classes={["Asset"]}
                  helperText={t`The account this bank's cash posts through.`}
                />
                <BankAccountFields initialFields={storedFields} />
                <Boolean name="active" label={t`Active`} />
                <CustomFormFields table="bankAccount" />
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

export default BankAccountForm;

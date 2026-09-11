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
import { CustomFormFields, Hidden, Input, Submit } from "~/components/Form";
import BankAccountFields from "~/components/Form/BankAccountFields";
import { usePermissions } from "~/hooks";
import { customerBankAccountValidator } from "~/modules/sales";
import { path } from "~/utils/path";

type CustomerBankAccountFormProps = {
  customerId: string;
  initialValues: z.infer<typeof customerBankAccountValidator>;
  /** The bag already stored, when editing. */
  storedFields?: BankFieldEntry[];
  onClose: () => void;
};

const CustomerBankAccountForm = ({
  customerId,
  initialValues,
  storedFields,
  onClose
}: CustomerBankAccountFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  // Submit through a fetcher, like every other drawer form: a plain navigation submit
  // races the Submit button's unsaved-changes blocker, which sees the action's redirect
  // as "leaving with unsaved changes" and swallows the save.
  const fetcher = useFetcher();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = !permissions.can("update", "sales");

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
            validator={customerBankAccountValidator}
            method="post"
            action={
              isEditing
                ? path.to.customerBankAccount(customerId, initialValues.id!)
                : path.to.newCustomerBankAccount(customerId)
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
                <BankAccountFields initialFields={storedFields} />
                <CustomFormFields table="customerBankAccount" />
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

export default CustomerBankAccountForm;

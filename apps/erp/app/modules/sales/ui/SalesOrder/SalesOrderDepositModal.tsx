// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// LAND-299: bill a deposit or milestone on an order — a percent of the order total or a fixed amount.
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Form, useNavigation } from "react-router";
import { useCurrencyFormatter } from "~/hooks";
import { path } from "~/utils/path";

export default function SalesOrderDepositModal({
  orderId,
  orderTotal,
  alreadyBilled,
  onClose
}: {
  orderId: string;
  orderTotal: number;
  alreadyBilled: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const money = useCurrencyFormatter();
  const nav = useNavigation();
  const action = path.to.salesOrderDeposit(orderId);
  const busy = nav.state !== "idle" && nav.formAction === action;
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <Form method="post" action={action}>
          <ModalHeader>
            <ModalTitle>
              <Trans>Bill a deposit or milestone</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3 text-sm">
              <p>
                <Trans>Order total</Trans>: <b>{money.format(orderTotal)}</b>
                {alreadyBilled > 0 && (
                  <>
                    {" · "}
                    <Trans>Already invoiced on this order</Trans>:{" "}
                    <b>{money.format(alreadyBilled)}</b>
                  </>
                )}
              </p>
              <label className="flex flex-col gap-1">
                <Trans>Percent of the order</Trans>
                <input
                  name="percent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="30"
                  className="border rounded px-2 py-1 bg-background"
                />
              </label>
              <label className="flex flex-col gap-1">
                <Trans>Or an amount</Trans>
                <input
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="border rounded px-2 py-1 bg-background"
                />
              </label>
              <label className="flex flex-col gap-1">
                <Trans>Line description (optional)</Trans>
                <input
                  name="description"
                  type="text"
                  placeholder={t`Deposit 30% of the order`}
                  className="border rounded px-2 py-1 bg-background"
                />
              </label>
              <p className="text-muted-foreground">
                <Trans>
                  BOSS makes a Draft invoice with one line; check it and post it
                  as usual. On the final invoice, take the deposit off with a
                  negative line on "Deposit / progress billing".
                </Trans>
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" isLoading={busy} isDisabled={busy}>
              <Trans>Make invoice</Trans>
            </Button>
          </ModalFooter>
        </Form>
      </ModalContent>
    </Modal>
  );
}

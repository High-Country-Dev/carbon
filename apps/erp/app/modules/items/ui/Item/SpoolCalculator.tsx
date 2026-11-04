// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// LAND-299 (ABS, Wade: "Turn calculator hours into routing steps"): ABS's Estimate Time Calculator
// (SharePoint Engineering/Calculators/Estimate Time Calculator.xlsm, "Set By Engineer") inside BOSS. Same grid,
// same constants, same formulas:
//   Cut & Prep (min)  = cuts × cutMinPerIn × π·OD + cuts × cutSetup + fittings × fitPrepMinPerIn × π·OD + fittings × fitPrepSetup
//   Tack & Weld (min) = welds × weldMinPerIn × π·OD × passes + welds × weldSetup  (+ o-lets × 15 + valves × 20)
//   Pull Parts (min)  = (o-lets + valves + other parts + pull parts) × 10
// "Apply" writes the hours (Total Hours) onto the steps picked for each total.
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuCalculator } from "react-icons/lu";
import { useFetcher } from "react-router";

// pipe size → outside diameter (in) and the calculator's default passes
const SIZES: [number, number, number][] = [
  [0.5, 0.84, 1],
  [0.75, 1.05, 1],
  [1, 1.315, 1],
  [1.25, 1.66, 1],
  [1.5, 1.9, 1],
  [2, 2.375, 1],
  [2.5, 2.875, 2],
  [3, 3.5, 2],
  [3.5, 4, 2],
  [4, 4.5, 2],
  [4.5, 5, 2],
  [5, 5.5625, 3],
  [6, 6.625, 3],
  [8, 8.625, 3],
  [10, 10.75, 3],
  [12, 12.75, 4],
  [14, 14, 3],
  [16, 16, 3],
  [18, 18, 2],
  [20, 20, 3],
  [24, 24, 3]
];
const K = {
  cutMinPerIn: 3,
  cutSetup: 7,
  weldMinPerIn: 3,
  weldSetup: 10,
  fitPrepMinPerIn: 1.5,
  fitPrepSetup: 5,
  pullEach: 10,
  olet: 15,
  valve: 20
};

type Row = { cuts: number; fittings: number; welds: number; passes: number };
type Op = { id?: string; description?: string | null };

export function spoolHours(
  rows: Row[],
  extra: { olets: number; valves: number; other: number; pull: number }
) {
  let cut = 0,
    weld = 0;
  rows.forEach((r, i) => {
    const circ = Math.PI * SIZES[i][1];
    cut +=
      r.cuts * K.cutMinPerIn * circ +
      r.cuts * K.cutSetup +
      r.fittings * K.fitPrepMinPerIn * circ +
      r.fittings * K.fitPrepSetup;
    weld += r.welds * K.weldMinPerIn * circ * r.passes + r.welds * K.weldSetup;
  });
  weld += extra.olets * K.olet + extra.valves * K.valve;
  const pull =
    (extra.olets + extra.valves + extra.other + extra.pull) * K.pullEach;
  return { pull: pull / 60, cut: cut / 60, weld: weld / 60 };
}

const guess = (ops: Op[], words: string[]) =>
  ops.find((o) =>
    words.some((w) => (o.description ?? "").toLowerCase().includes(w))
  )?.id ?? "";

export default function SpoolCalculator({
  operations,
  isDisabled
}: {
  operations: Op[];
  isDisabled?: boolean;
}) {
  const { t } = useLingui();
  const disclosure = useDisclosure();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [rows, setRows] = useState<Row[]>(
    SIZES.map(([, , passes]) => ({ cuts: 0, fittings: 0, welds: 0, passes }))
  );
  const [extra, setExtra] = useState({
    olets: 0,
    valves: 0,
    other: 0,
    pull: 0
  });
  const ops = operations.filter((o) => o.id);
  const [target, setTarget] = useState(() => ({
    cut: guess(ops, ["cut"]),
    weld: guess(ops, ["weld", "tack"]),
    pull: guess(ops, ["pull", "pick"])
  }));
  const hours = useMemo(() => spoolHours(rows, extra), [rows, extra]);
  const set = (i: number, k: keyof Row, v: string) =>
    setRows((rs) =>
      rs.map((r, j) => (j === i ? { ...r, [k]: Number(v) || 0 } : r))
    );
  const num = (v: number, onChange: (s: string) => void) => (
    <input
      type="number"
      min="0"
      value={v || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-16 border rounded px-1 py-0.5 bg-background text-right"
    />
  );
  const pick = (k: "cut" | "weld" | "pull") => (
    <select
      value={target[k]}
      onChange={(e) => setTarget((s) => ({ ...s, [k]: e.target.value }))}
      className="border rounded px-1 py-0.5 bg-background text-sm max-w-[220px]"
    >
      <option value="">{t`Don't write`}</option>
      {ops.map((o) => (
        <option key={o.id} value={o.id}>
          {o.description || o.id}
        </option>
      ))}
    </select>
  );
  const apply = () => {
    const updates = (["cut", "weld", "pull"] as const)
      .filter((k) => target[k])
      .map((k) => ({ id: target[k], hours: Math.round(hours[k] * 100) / 100 }));
    fetcher.submit(
      { updates: JSON.stringify(updates) },
      { method: "post", action: "/x/items/methods/operation/hours" }
    );
  };
  return (
    <>
      <Button
        variant="secondary"
        leftIcon={<LuCalculator />}
        isDisabled={isDisabled}
        onClick={disclosure.onOpen}
      >
        <Trans>Spool Calculator</Trans>
      </Button>
      {disclosure.isOpen && (
        <Modal open onOpenChange={(o) => !o && disclosure.onClose()}>
          <ModalContent size="large">
            <ModalHeader>
              <ModalTitle>
                <Trans>Spool Calculator</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-3 text-sm max-h-[60vh] overflow-y-auto">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>
                        <Trans>Pipe size</Trans>
                      </Th>
                      <Th>
                        <Trans>Cuts</Trans>
                      </Th>
                      <Th>
                        <Trans>Fittings</Trans>
                      </Th>
                      <Th>
                        <Trans>Welds</Trans>
                      </Th>
                      <Th>
                        <Trans>Passes</Trans>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {SIZES.map(([size], i) => (
                      <Tr key={size}>
                        <Td>{size}"</Td>
                        <Td>{num(rows[i].cuts, (v) => set(i, "cuts", v))}</Td>
                        <Td>
                          {num(rows[i].fittings, (v) => set(i, "fittings", v))}
                        </Td>
                        <Td>{num(rows[i].welds, (v) => set(i, "welds", v))}</Td>
                        <Td>
                          {num(rows[i].passes, (v) => set(i, "passes", v))}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2">
                    <Trans>O-lets</Trans>
                    {num(extra.olets, (v) =>
                      setExtra((e) => ({ ...e, olets: Number(v) || 0 }))
                    )}
                  </label>
                  <label className="flex items-center gap-2">
                    <Trans>Valves</Trans>
                    {num(extra.valves, (v) =>
                      setExtra((e) => ({ ...e, valves: Number(v) || 0 }))
                    )}
                  </label>
                  <label className="flex items-center gap-2">
                    <Trans>Other parts</Trans>
                    {num(extra.other, (v) =>
                      setExtra((e) => ({ ...e, other: Number(v) || 0 }))
                    )}
                  </label>
                  <label className="flex items-center gap-2">
                    <Trans>Pull parts</Trans>
                    {num(extra.pull, (v) =>
                      setExtra((e) => ({ ...e, pull: Number(v) || 0 }))
                    )}
                  </label>
                </div>
                <Table>
                  <Thead>
                    <Tr>
                      <Th />
                      <Th className="text-right">
                        <Trans>Hours</Trans>
                      </Th>
                      <Th>
                        <Trans>Write to step</Trans>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    <Tr>
                      <Td>
                        <Trans>Cut & Prep</Trans>
                      </Td>
                      <Td className="text-right">{hours.cut.toFixed(2)}</Td>
                      <Td>{pick("cut")}</Td>
                    </Tr>
                    <Tr>
                      <Td>
                        <Trans>Tack & Weld</Trans>
                      </Td>
                      <Td className="text-right">{hours.weld.toFixed(2)}</Td>
                      <Td>{pick("weld")}</Td>
                    </Tr>
                    <Tr>
                      <Td>
                        <Trans>Pull Parts</Trans>
                      </Td>
                      <Td className="text-right">{hours.pull.toFixed(2)}</Td>
                      <Td>{pick("pull")}</Td>
                    </Tr>
                  </Tbody>
                </Table>
                {fetcher.data?.error && (
                  <p className="text-red-500">{fetcher.data.error}</p>
                )}
                {fetcher.data?.ok && (
                  <p className="text-emerald-600">
                    <Trans>Hours written to the steps.</Trans>
                  </p>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={disclosure.onClose}>
                <Trans>Close</Trans>
              </Button>
              <Button
                isDisabled={
                  fetcher.state !== "idle" ||
                  !(target.cut || target.weld || target.pull)
                }
                isLoading={fetcher.state !== "idle"}
                onClick={apply}
              >
                <Trans>Write hours to steps</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
}

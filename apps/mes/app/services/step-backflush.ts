// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** An untracked job material the step-record backflush may issue. */
export type StepBackflushMaterial = {
  id: string;
  itemId: string;
  quantity: number | null;
  quantityIssued: number | null;
  jobOperationId: string | null;
};

export type StepBackflushLink = {
  jobMaterialId: string;
  jobOperationStepId: string;
  // NULL = the full BOM line quantity.
  quantity: number | null;
};

export type StepBackflushIssue = {
  materialId: string;
  itemId: string;
  quantity: number;
};

/**
 * Whether an operation owns a loose (step-unassigned) part: the part is on this
 * operation, or on no operation at all. A part attached to another operation of
 * the same make method is that operation's, the same attribution the completion
 * backflush (`issueJobOperationMaterials`, by `jobOperationId`) uses.
 */
export function ownsLooseMaterial(
  material: Pick<StepBackflushMaterial, "jobOperationId">,
  operationId: string
) {
  return (
    material.jobOperationId === null || material.jobOperationId === operationId
  );
}

/**
 * What recording one of an operation's steps issues. Step ownership:
 *   • A step-assigned part (jobMaterialStep) is owned by its assigned step(s)
 *     and issues when any of those steps is recorded for a unit.
 *   • A loose part (no step assignment) is owned by its operation's FIRST step,
 *     where the operator sees it. A loose part on another operation is skipped.
 * Per material the target is (distinct units that recorded an owning step) ×
 * per-unit quantity, and only the shortfall against `quantityIssued` is issued,
 * so re-records, undo/redo, manual issues and the completion backflush overlap
 * without double-issuing. A part assigned to several steps is counted once per
 * unit, so its requirement never multiplies. A line split across steps (per-link
 * quantities) issues each step's share, capped at the line.
 */
export function planStepBackflush(args: {
  operationId: string;
  // The operation's steps, in order.
  stepIds: string[];
  materials: StepBackflushMaterial[];
  stepLinks: StepBackflushLink[];
  records: { jobOperationStepId: string; index: number }[];
}): StepBackflushIssue[] {
  const firstStepId = args.stepIds[0];
  if (!firstStepId) return [];

  const ownedSteps = new Map<string, Set<string>>();
  const linkQuantities = new Map<string, Map<string, number | null>>();
  for (const link of args.stepLinks) {
    const set = ownedSteps.get(link.jobMaterialId) ?? new Set<string>();
    set.add(link.jobOperationStepId);
    ownedSteps.set(link.jobMaterialId, set);
    const quantities =
      linkQuantities.get(link.jobMaterialId) ??
      new Map<string, number | null>();
    quantities.set(link.jobOperationStepId, link.quantity);
    linkQuantities.set(link.jobMaterialId, quantities);
  }

  // Units (index) that have recorded each of the operation's steps.
  const unitsByStep = new Map<string, Set<number>>();
  for (const r of args.records) {
    const set = unitsByStep.get(r.jobOperationStepId) ?? new Set<number>();
    set.add(r.index);
    unitsByStep.set(r.jobOperationStepId, set);
  }

  const issues: StepBackflushIssue[] = [];
  for (const material of args.materials) {
    const perUnit = material.quantity ?? 0;
    if (perUnit <= 0) continue;
    // Owning steps: the material's assigned steps (scoped to this operation), or
    // the first step when it's loose and this operation owns it.
    const owning = ownedSteps.get(material.id);
    const isLoose = !owning || owning.size === 0;
    if (isLoose && !ownsLooseMaterial(material, args.operationId)) continue;
    const triggerStepIds = isLoose
      ? [firstStepId]
      : args.stepIds.filter((id) => owning.has(id));
    const quantities = linkQuantities.get(material.id);
    const hasSplitQuantities = triggerStepIds.some(
      (id) => (quantities?.get(id) ?? null) !== null
    );
    // Distinct units that recorded at least one owning step — the line-level
    // requirement bound: a material can never owe more than units × per-unit.
    const units = new Set<number>();
    for (const id of triggerStepIds) {
      for (const idx of unitsByStep.get(id) ?? []) units.add(idx);
    }
    let target: number;
    if (hasSplitQuantities) {
      // The line is SPLIT across steps (5 screws at step 1, 5 at step 2): each
      // owning step consumes its own share as it is recorded, so the target is
      // the per-step sum. A link left without an explicit quantity falls back
      // to the full per-unit quantity for its step. The sum is capped at the
      // line-level bound — the BOM line is the source of truth, so shares that
      // over-allocate the line (2 + 10 on a 5-quantity line) must not issue
      // more stock than the line requires.
      target = Math.min(
        triggerStepIds.reduce(
          (sum, id) =>
            sum +
            (unitsByStep.get(id)?.size ?? 0) * (quantities?.get(id) ?? perUnit),
          0
        ),
        units.size * perUnit
      );
    } else {
      // Unsplit: distinct units counted once, so the requirement never
      // multiplies across a material's several owning steps.
      target = units.size * perUnit;
    }
    const delta = target - (material.quantityIssued ?? 0);
    if (delta <= 0) continue;
    issues.push({
      materialId: material.id,
      itemId: material.itemId,
      quantity: delta
    });
  }
  return issues;
}

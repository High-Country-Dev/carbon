import type { MigrationSource, MigrationSourceId } from "../source.ts";
import { netsuiteSource } from "./netsuite/index.ts";

/**
 * Every source Carbon can migrate from.
 *
 * Adding one is: a directory under `sources/`, a `MigrationSource` export, an
 * entry here, and a member on `MigrationSourceId`. Nothing in the harness, the
 * job or the UI enumerates sources any other way — the migrations page renders
 * this array, so a new source appears with no second edit.
 */
export const MIGRATION_SOURCES: MigrationSource[] = [netsuiteSource];

export function getMigrationSource(id: string): MigrationSource | undefined {
  // hasOwn-style guard rather than a bare find on a user-supplied string: an id
  // that is not a source must be undefined, never a partial match.
  return MIGRATION_SOURCES.find((source) => source.id === id);
}

export function isMigrationSourceId(id: string): id is MigrationSourceId {
  return getMigrationSource(id) !== undefined;
}

export { netsuiteSource } from "./netsuite/index.ts";

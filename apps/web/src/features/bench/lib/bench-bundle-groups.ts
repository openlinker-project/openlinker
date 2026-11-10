/**
 * Bench bundle groups (#3624)
 *
 * A bundle reaches the bench as its components, each a line of the parcel. The
 * packer needs them kept together under the bundle's name, with how many of its
 * items are already in the box, and a plain refusal when everything else is
 * done and a bundle component cannot be verified: a bundle must never leave in parts.
 *
 * Pure and display-only. The parcel still closes on the system's own count of
 * every line (D18), so this can only explain a state, never change one.
 *
 * @module apps/web/src/features/bench/lib
 */
import type { BenchParcelLine } from '../api/bench-parcel.types';

export interface BenchBundleGroup {
  lineId: string;
  name: string | null;
  lines: BenchParcelLine[];
  /** Units of the bundle's components that are in the box. */
  done: number;
  /** Units of the bundle's components the parcel needs. */
  total: number;
  /** Names of the component lines that are not complete yet. */
  missingNames: string[];
  complete: boolean;
}

/** Keep each bundle's components next to each other, at the place its first one sits. */
export function clusterBundleLines(lines: readonly BenchParcelLine[]): BenchParcelLine[] {
  const placed = new Set<string>();
  const result: BenchParcelLine[] = [];
  for (const line of lines) {
    if (placed.has(line.workLineId)) continue;
    const bundleId = line.bundle?.lineId;
    if (bundleId === undefined) {
      result.push(line);
      placed.add(line.workLineId);
      continue;
    }
    for (const sibling of lines) {
      if (sibling.bundle?.lineId === bundleId && !placed.has(sibling.workLineId)) {
        result.push(sibling);
        placed.add(sibling.workLineId);
      }
    }
  }
  return result;
}

export function bundleGroups(lines: readonly BenchParcelLine[]): BenchBundleGroup[] {
  const byBundle = new Map<string, BenchBundleGroup>();
  for (const line of lines) {
    if (!line.bundle) continue;
    const group =
      byBundle.get(line.bundle.lineId) ??
      ({
        lineId: line.bundle.lineId,
        name: line.bundle.name,
        lines: [],
        done: 0,
        total: 0,
        missingNames: [],
        complete: true,
      } satisfies BenchBundleGroup);
    group.lines.push(line);
    group.done += line.verifiedQuantity;
    group.total += line.requiredQuantity;
    if (line.verifiedQuantity < line.requiredQuantity) {
      group.complete = false;
      group.missingNames.push(line.name ?? line.sku ?? line.productVariantId);
    }
    byBundle.set(line.bundle.lineId, group);
  }
  return [...byBundle.values()];
}

/** A line the packer has nothing to scan for: no EAN, GTIN or SKU on the wire. */
function isUnscannable(line: BenchParcelLine): boolean {
  return line.ean === null && line.gtin === null && line.sku === null;
}

/**
 * The bundle that is the ONLY thing keeping the parcel open AND cannot be
 * finished by scanning: everything outside it is complete and at least one of
 * its missing components has no code to scan. `null` while the packer is simply
 * still scanning, so the refusal appears when it is true and not as a banner the
 * packer sees during ordinary packing (the box closes on the system's own count,
 * D18; scanning the last component finishes a bundle that has codes).
 */
export function bundleBlockingClose(lines: readonly BenchParcelLine[]): BenchBundleGroup | null {
  const groups = bundleGroups(lines);
  const open = groups.filter((group) => !group.complete);
  if (open.length !== 1) return null;
  const [blocked] = open;
  const cannotBeVerified = blocked.lines.some(
    (line) => line.verifiedQuantity < line.requiredQuantity && isUnscannable(line),
  );
  if (!cannotBeVerified) return null;
  const othersDone = lines
    .filter((line) => line.bundle?.lineId !== blocked.lineId)
    .every((line) => line.verifiedQuantity >= line.requiredQuantity);
  return othersDone ? blocked : null;
}

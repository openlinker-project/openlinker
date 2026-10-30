/**
 * Line removed by an order edit (E-14)
 *
 * Pure: decides whether an operator-typed return line names a channel line that
 * an OpenLinker edit lowered to quantity 0. Identity is the sku when the
 * operator typed one, otherwise the name; both trimmed, neither case-folded
 * (identifiers, not display prose). A line that does not match any removed line
 * is NOT refused, so an unknown sku keeps its pre-E-14 behaviour. A shared
 * identity with a still-live line wins, since the return may be about that one.
 *
 * @module libs/core/src/returns/domain/domain-services
 */
export interface LineIdentity {
  sku: string | null;
  name: string | null;
}

function keyOf(line: LineIdentity): string | null {
  const sku = line.sku?.trim() ?? '';
  if (sku.length > 0) return `sku:${sku}`;
  const name = line.name?.trim() ?? '';
  return name.length > 0 ? `name:${name}` : null;
}

export function findLineRemovedByEdit(
  returnLine: LineIdentity,
  removedByEdit: ReadonlyArray<LineIdentity>,
  live: ReadonlyArray<LineIdentity>
): LineIdentity | null {
  const key = keyOf(returnLine);
  if (key === null) return null;
  const removed = removedByEdit.find((candidate) => keyOf(candidate) === key);
  if (removed === undefined) return null;
  return live.some((candidate) => keyOf(candidate) === key) ? null : removed;
}

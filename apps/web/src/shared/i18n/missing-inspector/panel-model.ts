/**
 * Panel model
 *
 * Turns what is on screen (scanner findings) and what was read (the read
 * tracker) into the panel's list: one row per fallback key, grouped by
 * namespace, each saying where it is used - or that it was read but is not
 * on screen. Pure, so the list can be tested without the DOM painter.
 *
 * @module shared/i18n/missing-inspector
 */
import type { FallbackEntry } from './registry';
import type { InspectedAttribute, ScanFinding } from './scan';

export type FallbackUsage = 'text' | InspectedAttribute;

export interface PanelRow {
  readonly entry: FallbackEntry;
  /** Empty when the key was read but nothing on screen shows it. */
  readonly usages: readonly FallbackUsage[];
  /** The first place it appears, for "scroll to". */
  readonly target: ScanFinding | null;
}

export interface PanelGroup {
  readonly namespace: string;
  readonly rows: readonly PanelRow[];
}

export function buildPanelGroups(
  findings: readonly ScanFinding[],
  reads: ReadonlySet<number>,
  lookup: (id: number) => FallbackEntry | undefined,
): PanelGroup[] {
  const usages = new Map<number, Set<FallbackUsage>>();
  const targets = new Map<number, ScanFinding>();
  for (const finding of findings) {
    const set = usages.get(finding.id) ?? new Set<FallbackUsage>();
    set.add(finding.kind === 'text' ? 'text' : finding.attribute);
    usages.set(finding.id, set);
    if (!targets.has(finding.id)) targets.set(finding.id, finding);
  }
  const ids = new Set<number>([...usages.keys(), ...reads]);
  const groups = new Map<string, PanelRow[]>();
  for (const id of ids) {
    const entry = lookup(id);
    if (entry === undefined) continue;
    const rows = groups.get(entry.namespace) ?? [];
    rows.push({ entry, usages: [...(usages.get(id) ?? [])], target: targets.get(id) ?? null });
    groups.set(entry.namespace, rows);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, rows]) => ({
      namespace,
      rows: rows.sort((a, b) =>
        a.entry.keyPath === b.entry.keyPath
          ? a.entry.kind.localeCompare(b.entry.kind)
          : a.entry.keyPath.localeCompare(b.entry.keyPath),
      ),
    }));
}

/** `namespace.keyPath` lines for a translator, one per key. */
export function formatPanelList(groups: readonly PanelGroup[]): string {
  const lines = new Set<string>();
  for (const group of groups) {
    for (const row of group.rows) lines.add(`${group.namespace}.${row.entry.keyPath}`);
  }
  return [...lines].join('\n');
}

export function countRows(groups: readonly PanelGroup[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}

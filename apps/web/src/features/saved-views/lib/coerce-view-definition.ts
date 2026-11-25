/**
 * Coerce View Definition
 *
 * Reads a stored definition defensively. The server keeps it opaque and a stale
 * one must never throw in the browser, so anything unreadable degrades to an
 * empty field rather than failing the whole list of views.
 *
 * @module apps/web/src/features/saved-views/lib
 */
import { VIEW_DEFINITION_VERSION, type ViewDefinition, type ViewSort } from './saved-view.types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function coerceSort(value: unknown): ViewSort | null {
  if (!isRecord(value) || typeof value.key !== 'string' || value.key === '') return null;
  return { key: value.key, dir: value.dir === 'asc' ? 'asc' : 'desc' };
}

export function coerceViewDefinition(raw: unknown): ViewDefinition {
  const source = isRecord(raw) ? raw : {};
  const parts: Record<string, string[]> = {};
  if (isRecord(source.parts)) {
    for (const [columnId, ids] of Object.entries(source.parts)) parts[columnId] = strings(ids);
  }
  const definition: ViewDefinition = {
    v: VIEW_DEFINITION_VERSION,
    query: typeof source.query === 'string' ? source.query : '',
    sort: coerceSort(source.sort),
    columns: strings(source.columns),
    parts,
  };
  if (typeof source.pageSize === 'number' && Number.isFinite(source.pageSize)) {
    definition.pageSize = source.pageSize;
  }
  return definition;
}

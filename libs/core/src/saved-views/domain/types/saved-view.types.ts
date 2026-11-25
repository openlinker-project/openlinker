/**
 * Saved View Types
 *
 * A saved view is a named, restorable arrangement of one list page: the filter
 * query, the sort, the visible columns and the per-column field order. The
 * context is page-agnostic - `pageKey` is an opaque string whose registry of
 * valid values lives in `apps/api`, and column / part ids are opaque strings
 * the frontend owns - so a new list page never touches this context.
 *
 * Three kinds exist in the product. `system` views live in frontend code and
 * are never rows; only `personal` and `shared` are persisted here.
 *
 * `readSavedViewDefinition` and `checkSavedViewDefinition` are the pure rules
 * for the definition type (the `*.types.ts` pure-rule exception in
 * `docs/engineering-standards.md`): one coerces tolerantly on READ, the other
 * validates strictly on WRITE, and both change with the shape.
 *
 * @module libs/core/src/saved-views/domain/types
 */

export const SavedViewScopeValues = ['personal', 'shared'] as const;
export type SavedViewScope = (typeof SavedViewScopeValues)[number];

export const SortDirectionValues = ['asc', 'desc'] as const;
export type SavedViewSortDirection = (typeof SortDirectionValues)[number];

/** The definition shape version this build writes and fully understands. */
export const SAVED_VIEW_DEFINITION_VERSION = 1;

export const SAVED_VIEW_LIMITS = {
  /** Serialized definition size, in bytes. */
  definitionBytes: 16384,
  columns: 64,
  queryChars: 2048,
  /** Personal views per user and page. */
  personalViewsPerUserAndPage: 50,
  nameChars: 100,
  idChars: 64,
  pageSizeMax: 500,
} as const;

export interface SavedViewSort {
  key: string;
  dir: SavedViewSortDirection;
}

export interface SavedViewDefinition {
  v: number;
  /** Serialized filter query string, no offset or cursor. */
  query: string;
  sort: SavedViewSort | null;
  /** Visible column ids, in display order. */
  columns: string[];
  /** Only deviations from a column's default fields: colId -> visible part ids in order. */
  parts: Record<string, string[]>;
  pageSize?: number;
}

/** What a caller is, as far as authorization goes. Core never sees role strings. */
export interface SavedViewActor {
  userId: string;
  isAdmin: boolean;
}

export const SavedViewLimitRuleValues = [
  'malformed',
  'definition-too-large',
  'too-many-columns',
  'query-too-long',
  'too-many-views',
  'invalid-name',
] as const;
export type SavedViewLimitRule = (typeof SavedViewLimitRuleValues)[number];

const emptyDefinition = (): SavedViewDefinition => ({
  v: SAVED_VIEW_DEFINITION_VERSION,
  query: '',
  sort: null,
  columns: [],
  parts: {},
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export interface ReadSavedViewDefinitionResult {
  definition: SavedViewDefinition;
  /** True when anything stored was not understood and had to be dropped or defaulted. */
  stale: boolean;
}

/**
 * Tolerant read: never throws, whatever a stored row holds. A view written by
 * an older or newer build, or edited by hand, must still render in the list so
 * its owner can repair or delete it - a 500 here would hide the very row that
 * needs fixing.
 */
export function readSavedViewDefinition(raw: unknown): ReadSavedViewDefinitionResult {
  if (!isRecord(raw)) {
    return { definition: emptyDefinition(), stale: true };
  }
  let stale = false;

  const v = typeof raw.v === 'number' && Number.isInteger(raw.v) && raw.v >= 1 ? raw.v : null;
  if (v === null || v !== SAVED_VIEW_DEFINITION_VERSION) stale = true;

  let query = '';
  if (typeof raw.query === 'string') query = raw.query;
  else stale = true;

  let sort: SavedViewSort | null = null;
  if (raw.sort === null || raw.sort === undefined) {
    sort = null;
  } else if (
    isRecord(raw.sort) &&
    typeof raw.sort.key === 'string' &&
    (raw.sort.dir === 'asc' || raw.sort.dir === 'desc')
  ) {
    sort = { key: raw.sort.key, dir: raw.sort.dir };
  } else {
    stale = true;
  }

  let columns: string[] = [];
  if (isStringArray(raw.columns)) columns = raw.columns;
  else stale = true;

  const parts: Record<string, string[]> = {};
  if (raw.parts === undefined) {
    // Absent is the legitimate "no deviations" spelling.
  } else if (isRecord(raw.parts)) {
    for (const [key, value] of Object.entries(raw.parts)) {
      if (isStringArray(value)) parts[key] = value;
      else stale = true;
    }
  } else {
    stale = true;
  }

  const definition: SavedViewDefinition = {
    v: v ?? SAVED_VIEW_DEFINITION_VERSION,
    query,
    sort,
    columns,
    parts,
  };
  if (raw.pageSize !== undefined) {
    if (typeof raw.pageSize === 'number' && Number.isInteger(raw.pageSize) && raw.pageSize > 0) {
      definition.pageSize = raw.pageSize;
    } else {
      stale = true;
    }
  }
  return { definition, stale };
}

export interface SavedViewDefinitionBreach {
  rule: SavedViewLimitRule;
  field: string;
  message: string;
  limit?: number;
}

/**
 * Strict write check. Returns the first breach, or `null` when the definition
 * is acceptable. Limits live here (not only in a DTO) because the browser is
 * not the only way in.
 */
export function checkSavedViewDefinition(raw: unknown): SavedViewDefinitionBreach | null {
  if (!isRecord(raw)) {
    return { rule: 'malformed', field: 'definition', message: 'definition must be an object' };
  }
  if (typeof raw.v !== 'number' || !Number.isInteger(raw.v) || raw.v < 1) {
    return { rule: 'malformed', field: 'definition.v', message: 'v must be a positive integer' };
  }
  if (typeof raw.query !== 'string') {
    return { rule: 'malformed', field: 'definition.query', message: 'query must be a string' };
  }
  if (raw.query.length > SAVED_VIEW_LIMITS.queryChars) {
    return {
      rule: 'query-too-long',
      field: 'definition.query',
      message: `query must be at most ${SAVED_VIEW_LIMITS.queryChars} characters`,
      limit: SAVED_VIEW_LIMITS.queryChars,
    };
  }
  if (raw.sort !== null && raw.sort !== undefined) {
    const sort = raw.sort;
    if (
      !isRecord(sort) ||
      typeof sort.key !== 'string' ||
      sort.key.length === 0 ||
      sort.key.length > SAVED_VIEW_LIMITS.idChars ||
      (sort.dir !== 'asc' && sort.dir !== 'desc')
    ) {
      return {
        rule: 'malformed',
        field: 'definition.sort',
        message: 'sort must be null or { key, dir: asc|desc }',
      };
    }
  }
  if (!isStringArray(raw.columns) || raw.columns.some((id) => id.length === 0 || id.length > SAVED_VIEW_LIMITS.idChars)) {
    return {
      rule: 'malformed',
      field: 'definition.columns',
      message: 'columns must be an array of non-empty column ids',
    };
  }
  if (raw.columns.length > SAVED_VIEW_LIMITS.columns) {
    return {
      rule: 'too-many-columns',
      field: 'definition.columns',
      message: `a view may list at most ${SAVED_VIEW_LIMITS.columns} columns`,
      limit: SAVED_VIEW_LIMITS.columns,
    };
  }
  if (raw.parts !== undefined) {
    if (!isRecord(raw.parts)) {
      return { rule: 'malformed', field: 'definition.parts', message: 'parts must be an object' };
    }
    for (const [key, value] of Object.entries(raw.parts)) {
      if (
        key.length === 0 ||
        key.length > SAVED_VIEW_LIMITS.idChars ||
        !isStringArray(value) ||
        value.length > SAVED_VIEW_LIMITS.columns ||
        value.some((id) => id.length === 0 || id.length > SAVED_VIEW_LIMITS.idChars)
      ) {
        return {
          rule: 'malformed',
          field: `definition.parts.${key}`,
          message: 'parts must map a column id to an array of part ids',
        };
      }
    }
  }
  if (raw.pageSize !== undefined) {
    if (
      typeof raw.pageSize !== 'number' ||
      !Number.isInteger(raw.pageSize) ||
      raw.pageSize < 1 ||
      raw.pageSize > SAVED_VIEW_LIMITS.pageSizeMax
    ) {
      return {
        rule: 'malformed',
        field: 'definition.pageSize',
        message: `pageSize must be an integer between 1 and ${SAVED_VIEW_LIMITS.pageSizeMax}`,
      };
    }
  }
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > SAVED_VIEW_LIMITS.definitionBytes) {
    return {
      rule: 'definition-too-large',
      field: 'definition',
      message: `definition must be at most ${SAVED_VIEW_LIMITS.definitionBytes} bytes`,
      limit: SAVED_VIEW_LIMITS.definitionBytes,
    };
  }
  return null;
}

/** Trim and bound a view name. Returns the normalised name, or `null` when unusable. */
export function normaliseSavedViewName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length === 0 || name.length > SAVED_VIEW_LIMITS.nameChars) return null;
  return name;
}

export interface CreateSavedViewInput {
  pageKey: string;
  name: string;
  scope: SavedViewScope;
  definition: unknown;
  /** Admin-only, shared views only: make this the default for users with no default of their own. */
  workspaceDefault?: boolean;
}

export interface UpdateSavedViewInput {
  name?: string;
  definition?: unknown;
  workspaceDefault?: boolean;
  expectedRevision: number;
}

/** A view as the API reads it: tolerant definition plus the caller-relative flags. */
export interface SavedViewReadModel {
  id: string;
  pageKey: string;
  scope: SavedViewScope;
  name: string;
  definition: SavedViewDefinition;
  /** True when the stored definition was not fully understood; it is still returned. */
  stale: boolean;
  revision: number;
  /** Personal: the owner. Shared: null. */
  ownerUserId: string | null;
  /** Who created it, kept for shared views whose owner is null. May name a since-deleted user. */
  createdByUserId: string | null;
  isWorkspaceDefault: boolean;
  /** Is this the view the CALLER lands on, after the fallback chain. */
  isDefault: boolean;
  /** May the caller edit or delete it. */
  canEdit: boolean;
  createdAt: Date;
  updatedAt: Date;
}

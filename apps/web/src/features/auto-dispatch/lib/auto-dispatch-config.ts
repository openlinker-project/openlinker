/**
 * Automatic shipping labels - config read and write (#2729)
 *
 * `PATCH /connections/:id` REPLACES `config` wholesale, so a save is always the
 * freshly-read config with exactly one key changed (`withAutoDispatch`). Inside
 * that key the same rule holds one level down: anything this screen does not
 * own (a future field, or one set by hand) is carried through untouched.
 *
 * A cleared knob is OMITTED rather than written as `null`: the backend refuses a
 * `null` weight or box as "must be a number greater than 0", and because the
 * whole `autoDispatch` object is replaced, omission is what removes it.
 *
 * Reading is lenient (a stored value this screen cannot show reads as the
 * default), mirroring the backend's `readAutoDispatchConfig`; the browser cannot
 * import `@openlinker/core` (#591), so the rules are restated here.
 *
 * @module apps/web/src/features/auto-dispatch/lib
 */
import {
  AutoDispatchTriggerValues,
  type AutoDispatchTrigger,
} from '../api/auto-dispatch.types';

export const AUTO_DISPATCH_CONFIG_KEY = 'autoDispatch';
export const DEFAULT_AUTO_DISPATCH_TRIGGER: AutoDispatchTrigger = 'on-accept';

/** What the form edits. Numbers are strings so an empty box is representable. */
export interface AutoDispatchFormState {
  readonly enabled: boolean;
  readonly trigger: AutoDispatchTrigger;
  readonly defaultWeightGrams: string;
  readonly parcelTemplate: string;
  readonly lengthMm: string;
  readonly widthMm: string;
  readonly heightMm: string;
}

/** The validated, typed shape a save writes. A missing key means "not set". */
export interface AutoDispatchSettings {
  readonly enabled: boolean;
  readonly trigger: AutoDispatchTrigger;
  readonly defaultWeightGrams?: number;
  readonly parcelTemplate?: string;
  readonly lengthMm?: number;
  readonly widthMm?: number;
  readonly heightMm?: number;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isTrigger(value: unknown): value is AutoDispatchTrigger {
  return typeof value === 'string' && (AutoDispatchTriggerValues as readonly string[]).includes(value);
}

function toInput(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? String(value) : '';
}

/** The stored `autoDispatch` key as form values. Absent or malformed reads as "off, on-accept, empty". */
export function readAutoDispatchForm(
  config: Record<string, unknown> | null | undefined
): AutoDispatchFormState {
  const stored = asObject(config?.[AUTO_DISPATCH_CONFIG_KEY]);
  return {
    enabled: stored?.enabled === true,
    trigger: isTrigger(stored?.trigger) ? stored.trigger : DEFAULT_AUTO_DISPATCH_TRIGGER,
    defaultWeightGrams: toInput(stored?.defaultWeightGrams),
    parcelTemplate:
      typeof stored?.parcelTemplate === 'string' ? stored.parcelTemplate : '',
    lengthMm: toInput(stored?.lengthMm),
    widthMm: toInput(stored?.widthMm),
    heightMm: toInput(stored?.heightMm),
  };
}

/** Are automatic labels switched on in this stored config? Anything unreadable reads as off. */
export function isAutoDispatchEnabled(config: Record<string, unknown> | null | undefined): boolean {
  return readAutoDispatchForm(config).enabled;
}

/** Is a stored `trigger` present but not one this build recognises? Shown, never silently dropped. */
export function hasUnrecognisedTrigger(config: Record<string, unknown> | null | undefined): boolean {
  const trigger = asObject(config?.[AUTO_DISPATCH_CONFIG_KEY])?.trigger;
  return trigger !== undefined && trigger !== null && !isTrigger(trigger);
}

/**
 * A new config with the `autoDispatch` key set from `settings`; every other
 * key on the connection, and every key inside `autoDispatch` this screen does
 * not own, is untouched.
 */
export function withAutoDispatch(
  config: Record<string, unknown> | null | undefined,
  settings: AutoDispatchSettings
): Record<string, unknown> {
  const existing = asObject(config?.[AUTO_DISPATCH_CONFIG_KEY]) ?? {};
  const OWNED = [
    'enabled',
    'trigger',
    'defaultWeightGrams',
    'parcelTemplate',
    'lengthMm',
    'widthMm',
    'heightMm',
  ];
  const carried = Object.fromEntries(Object.entries(existing).filter(([key]) => !OWNED.includes(key)));

  const next: Record<string, unknown> = {
    ...carried,
    enabled: settings.enabled,
    trigger: settings.trigger,
  };
  if (settings.defaultWeightGrams !== undefined) next.defaultWeightGrams = settings.defaultWeightGrams;
  if (settings.parcelTemplate !== undefined) next.parcelTemplate = settings.parcelTemplate;
  if (settings.lengthMm !== undefined) {
    next.lengthMm = settings.lengthMm;
    if (settings.widthMm !== undefined) next.widthMm = settings.widthMm;
    if (settings.heightMm !== undefined) next.heightMm = settings.heightMm;
  }

  return { ...(config ?? {}), [AUTO_DISPATCH_CONFIG_KEY]: next };
}

/** The draft a preview is computed against: only what is set, nothing else. */
export function toPreviewRequest(
  settings: AutoDispatchSettings,
  limit: number
): {
  parcelTemplate?: string;
  defaultWeightGrams?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  limit: number;
} {
  return {
    ...(settings.parcelTemplate !== undefined ? { parcelTemplate: settings.parcelTemplate } : {}),
    ...(settings.defaultWeightGrams !== undefined
      ? { defaultWeightGrams: settings.defaultWeightGrams }
      : {}),
    ...(settings.lengthMm !== undefined &&
    settings.widthMm !== undefined &&
    settings.heightMm !== undefined
      ? { lengthMm: settings.lengthMm, widthMm: settings.widthMm, heightMm: settings.heightMm }
      : {}),
    limit,
  };
}

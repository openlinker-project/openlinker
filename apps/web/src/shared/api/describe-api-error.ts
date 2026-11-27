/**
 * describeApiError (#3862)
 *
 * The one place an API error becomes the sentence an operator reads. The
 * backend sends a stable `code` and its `params`, never translated text
 * (ADR-081), so the copy is chosen here, in the active language:
 *
 * 1. the feature namespace's `apiErrors.<code>`, when the caller names one -
 *    a feature can say something more specific than the shared copy;
 * 2. the shared `errors.codes.<code>`;
 * 3. the copy for the HTTP status family (`errors.status.*`), so an unknown
 *    code - a newer backend, an endpoint not yet coded - still reads well.
 *
 * Never blank. A template whose placeholder the error does not fill is skipped,
 * not shown with a raw `{name}` in it. A provider refusal (`PROVIDER_REJECTED`)
 * reads a translated prefix plus the provider's own words verbatim. In
 * development an untranslated error shows `[untranslated:<code>]` and the raw
 * backend message, so a missing translation is seen rather than hidden.
 *
 * @module shared/api
 */
import { getLocale, getMessages, interpolate, namespaceFor } from '../i18n';
import { ApiError } from './api-error';
import type { ApiErrorParams } from './api-error.types';

export interface DescribeApiErrorOptions {
  /** Show the untranslated marker. Defaults to development builds, outside tests. */
  readonly dev?: boolean;
}

const UNFILLED_PLACEHOLDER = /\{\w+\}/;

export function describeApiError(
  error: unknown,
  featureNamespace?: string,
  options: DescribeApiErrorOptions = {}
): string {
  const copy = getMessages('errors');
  const dev = options.dev ?? (import.meta.env.DEV && import.meta.env.MODE !== 'test');

  if (!(error instanceof ApiError)) {
    const raw = error instanceof Error ? error.message : '';
    return dev && raw.length > 0 ? `[untranslated] ${raw}` : copy.status.other;
  }

  if (error.code === 'PROVIDER_REJECTED' && error.providerMessage !== undefined) {
    return interpolate(copy.providerRejected, { message: error.providerMessage });
  }

  if (error.code !== undefined) {
    const specific =
      fill(featureCopyFor(featureNamespace, error.code), error.params) ??
      fill(lookup(copy.codes, error.code), error.params);
    if (specific !== undefined) return specific;
  }

  const family = copy.status[statusFamily(error)];
  if (dev && error.message.length > 0) {
    return `[untranslated:${error.code ?? `HTTP_${String(error.status)}`}] ${error.message}`;
  }
  return family;
}

type StatusFamily =
  | '400'
  | '401'
  | '403'
  | '404'
  | '409'
  | '413'
  | '422'
  | '429'
  | '5xx'
  | 'network'
  | 'timeout'
  | 'other';

const EXACT_STATUSES = new Set(['400', '401', '403', '404', '409', '413', '422', '429']);

function statusFamily(error: ApiError): StatusFamily {
  if (error.isNetworkError()) {
    const details = error.details;
    const timedOut =
      typeof details === 'object' && details !== null && 'timeout' in details && details.timeout === true;
    return timedOut ? 'timeout' : 'network';
  }
  if (error.isServerError()) return '5xx';
  const status = String(error.status);
  return EXACT_STATUSES.has(status) ? (status as StatusFamily) : 'other';
}

function lookup(table: unknown, code: string): string | undefined {
  if (typeof table !== 'object' || table === null) return undefined;
  const value = (table as Record<string, unknown>)[code];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A feature's own copy for the code, from its namespace's `apiErrors` section. */
function featureCopyFor(namespace: string | undefined, code: string): string | undefined {
  if (namespace === undefined) return undefined;
  let tree: unknown;
  try {
    tree = namespaceFor(getLocale(), namespace);
  } catch {
    return undefined;
  }
  if (typeof tree !== 'object' || tree === null) return undefined;
  return lookup((tree as Record<string, unknown>).apiErrors, code);
}

/** The template with the params filled in, or `undefined` when one is still missing. */
function fill(template: string | undefined, params: ApiErrorParams): string | undefined {
  if (template === undefined) return undefined;
  const values = Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, typeof value === 'boolean' ? String(value) : value])
  );
  const text = interpolate(template, values);
  return UNFILLED_PLACEHOLDER.test(text) ? undefined : text;
}

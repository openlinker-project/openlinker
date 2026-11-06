/**
 * API error envelope types (#3862)
 *
 * The parts of an API error body the frontend reads (#3860, #3861): a stable
 * `code`, the `params` its copy needs, the invalid `fields` of a request body
 * and an external system's own words. Mirrors `ApiErrorEnvelope` in
 * `@openlinker/shared/errors`, which the browser bundle cannot import (#591).
 *
 * @module shared/api
 */

/** Values to put into an error's copy. Inputs, never sentences. */
export type ApiErrorParams = Readonly<Record<string, string | number | boolean>>;

/** One invalid field of a request body: a dotted path and its constraint code. */
export interface ApiErrorField {
  readonly path: string;
  readonly code: string;
  readonly params?: ApiErrorParams;
}

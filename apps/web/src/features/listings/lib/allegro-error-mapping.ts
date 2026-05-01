/**
 * Allegro Error Mapping
 *
 * Translates a curated allowlist of Allegro REST API error codes into
 * operator-actionable, English-language messages (#448). The BE forwards
 * Allegro's structured `{ field?, code, message }` payload via
 * `OfferCreationStatusResponse.errors` unchanged; this module sits at the
 * render boundary on the FE so the operator sees "what to do" instead of
 * "what Allegro literally said".
 *
 * Returns `null` when the code is not in the allowlist — callers fall back
 * to rendering Allegro's raw `userMessage` verbatim. The shape is an object
 * (not a bare string) so a future PR can extend it with a `cta` field for
 * deep-linking to the connection edit page without churning every call
 * site — see #448's deferred bullets.
 *
 * @module apps/web/src/features/listings/lib
 */
import type { OfferCreationError } from '../api/listings.types';

export interface AllegroErrorTranslation {
  /** Operator-facing replacement for `error.message`. */
  message: string;
}

type Translator = (error: OfferCreationError) => AllegroErrorTranslation;

/**
 * Allowlist of Allegro error codes we translate. Each entry is a function so
 * codes that need to interpolate `error.field` (e.g. `UnknownJSONProperty`)
 * can do so cleanly. Add new entries opportunistically as they surface from
 * real seller activity.
 */
const TRANSLATIONS: Record<string, Translator> = {
  SAFETY_INFO_NOT_DEFINED: () => ({
    message:
      "Allegro rejected the safety information for this category. Verify the discriminator (`type`) and re-save the connection's seller defaults. If the issue persists, the category likely requires a TEXT discriminator with substantive content rather than NO_SAFETY_INFORMATION.",
  }),
  NO_SAFETY_INFORMATION_OPTION_NOT_ALLOWED: () => ({
    message:
      "This category requires substantive safety information. Edit the connection and choose 'Provide safety information (text)' with category-relevant content (battery warnings, age restrictions, CE/RoHS, etc.).",
  }),
  UnknownJSONProperty: (error) => ({
    message: error.field
      ? `OpenLinker sent a field Allegro doesn't recognize at \`${error.field}\`. This is usually a regression in the OL Allegro adapter. Please file an issue with the offer id.`
      : "OpenLinker sent a field Allegro doesn't recognize. This is usually a regression in the OL Allegro adapter. Please file an issue with the offer id.",
  }),
  RESPONSIBLE_PRODUCER_NOT_SPECIFIED: () => ({
    message: "Configure a Responsible Producer entry in the connection's seller defaults.",
  }),
  UnsupportedLanguageInAcceptLanguageHeader: () => ({
    message:
      'OpenLinker sent an unsupported Accept-Language header. This is a regression — please file an issue.',
  }),
};

export function translateAllegroError(
  error: OfferCreationError,
): AllegroErrorTranslation | null {
  const translator = TRANSLATIONS[error.code];
  return translator ? translator(error) : null;
}

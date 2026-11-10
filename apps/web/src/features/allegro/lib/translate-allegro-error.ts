/**
 * Allegro Error Translator
 *
 * Translates a curated allowlist of Allegro REST API error codes into
 * operator-actionable, English-language messages (#448, extended for #486).
 * The BE forwards Allegro's structured `{ field?, code, message }` payload
 * unchanged through both `OfferCreationStatusResponse.errors` (offer-create)
 * and the `CHANNEL_PUBLISH_FAILED` 422 body (content-publish, #486). This
 * module sits at the render boundary on the FE so the operator sees "what
 * to do" instead of "what Allegro literally said".
 *
 * Returns `null` when the code is not in the allowlist — callers fall back
 * to rendering Allegro's raw `userMessage` / `message` verbatim. The shape is
 * an object (not a bare string) so a future PR can extend it with a `cta`
 * field for deep-linking to the connection-edit page without churning every
 * call site — see #448's deferred bullets and #486 §6 R1.
 *
 * Marketplace-specific by definition; lives under `features/allegro/lib/`
 * since #607 to keep `shared/` free of platform-named code. Consumed by
 * passing it to `<StructuredErrorList translate={translateAllegroError} />`
 * from any feature that surfaces Allegro errors.
 *
 * @module apps/web/src/features/allegro/lib
 */
import type {
  StructuredError,
  StructuredErrorTranslation,
} from '../../../shared/ui/structured-error-list';
import { getMessages, interpolate, type Messages, type ResolvedCopy } from '../../../shared/i18n';

type Translator = (error: StructuredError) => StructuredErrorTranslation;

/**
 * Allowlist of Allegro error codes we translate. Each entry is a function so
 * codes that need to interpolate `error.field` (e.g. `UnknownJSONProperty`)
 * can do so cleanly. Add new entries opportunistically as they surface from
 * real seller activity.
 *
 * Codes that arrive namespaced (e.g.
 * `ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany`)
 * are matched against the full string Allegro returns — we don't strip the
 * prefix because Allegro's own docs use the full identifier.
 */
function copy(): ResolvedCopy<Messages['allegro-core']>['translateAllegroError'] {
  return getMessages('allegro-core').translateAllegroError;
}

const TRANSLATIONS: Record<string, Translator> = {
  // #2255 / #2249. The adapter already puts the permitted values in the
  // message, so this only frames whose entry is probably wrong: when the
  // marketplace says the category allows 23% and OpenLinker sent 5%, the shop
  // record is the likelier mistake, and the shop is where a fix serves every channel.
  TAX_RATE_NOT_ALLOWED_IN_CATEGORY: (error) => ({
    message: interpolate(copy().taxRateNotAllowed, {
      // eslint-disable-next-line no-restricted-syntax -- a StructuredError from the marketplace payload, not an ApiError; its own words are the reason
      reason: error.message ?? copy().taxRateNotAllowedDefault,
    }),
  }),
  TAX_RATE_MISSING: () => ({ message: copy().taxRateMissing }),
  TAX_RATE_NOT_EXPRESSIBLE: (error) => ({
    // eslint-disable-next-line no-restricted-syntax -- a StructuredError from the marketplace payload, not an ApiError; its own words are the reason
    message: error.message ?? copy().taxRateNotExpressible,
  }),
  SAFETY_INFO_NOT_DEFINED: () => ({ message: copy().safetyInfoNotDefined }),
  NO_SAFETY_INFORMATION_OPTION_NOT_ALLOWED: () => ({
    message: copy().noSafetyInformationNotAllowed,
  }),
  UnknownJSONProperty: (error) => ({
    message: error.field
      ? interpolate(copy().unknownFieldAt, { field: error.field })
      : copy().unknownField,
  }),
  RESPONSIBLE_PRODUCER_NOT_SPECIFIED: () => ({ message: copy().responsibleProducerMissing }),
  // #486: incident on content publish — Business Account missing after-sales
  // policies. Full namespaced code as the marketplace returns it.
  'ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany': () => ({
    message: copy().afterSalesRequired,
  }),
  UnsupportedLanguageInAcceptLanguageHeader: () => ({ message: copy().unsupportedLanguage }),
};

export function translateAllegroError(
  error: StructuredError,
): StructuredErrorTranslation | null {
  // `Object.hasOwn` rather than a bare lookup so we can't accidentally
  // resolve to an inherited prototype method (e.g. `error.code === 'toString'`)
  // and call it with `(error)` — extremely unlikely from Allegro in practice,
  // but the guard is one line and free.
  if (!Object.hasOwn(TRANSLATIONS, error.code)) {
    return null;
  }
  return TRANSLATIONS[error.code](error);
}

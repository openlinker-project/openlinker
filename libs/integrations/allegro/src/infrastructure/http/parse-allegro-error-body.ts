/**
 * Parse Allegro Error Body
 *
 * Pure helper that extracts Allegro's structured `errors[]` array from the raw
 * response body of a 4xx/5xx HTTP response. Returns an empty array on null,
 * malformed JSON, or any shape that doesn't include `{ errors: [...] }` —
 * never throws. The breadcrumb log on parse failure mirrors the contract from
 * #409 / #416 (uncapped body, operator-tunable via `OL_LOG_BODY_MAX_BYTES`).
 *
 * Hoisted out of `AllegroOfferManagerAdapter` (#486) so `AllegroHttpClient`
 * can attach the parsed errors to every `AllegroApiException` it throws —
 * not just the offer-create path. Downstream consumers (content publish,
 * offer update, ...) read `error.allegroErrors` directly without re-parsing.
 *
 * @module libs/integrations/allegro/src/infrastructure/http
 */
import type { Logger } from '@openlinker/shared/logging';
import { formatBodyForLog } from '@openlinker/shared/logging';
import type { AllegroValidationError } from '../../domain/types/allegro-api.types';

interface AllegroErrorBodyShape {
  errors?: AllegroValidationError[];
}

export function parseAllegroErrorBody(
  responseBody: string | undefined | null,
  logger?: Logger
): AllegroValidationError[] {
  if (!responseBody) return [];
  try {
    const parsed = JSON.parse(responseBody) as AllegroErrorBodyShape;
    if (Array.isArray(parsed.errors)) {
      return parsed.errors;
    }
    return [];
  } catch (err) {
    // Genuinely malformed body (HTML proxy errors, gateway timeouts surfacing
    // as text/plain, etc.). Log a breadcrumb so operators don't silently see
    // an opaque "errors=0" upstream — same contract as #409.
    logger?.warn(
      `Failed to parse Allegro error body as JSON: ${(err as Error).message}. ` +
        `Raw body: ${formatBodyForLog(responseBody)}`
    );
    return [];
  }
}

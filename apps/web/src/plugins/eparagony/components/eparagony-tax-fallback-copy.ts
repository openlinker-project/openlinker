/**
 * eparagony.pl Tax-Fallback Copy (#3266)
 *
 * The hazard explanation behind `config.defaultTaxRateCode`, kept in one place
 * so the field description and the infotip cannot drift into two accounts of the
 * same rule. The sentences live in the `eparagony` namespace under
 * `taxFallback` (ADR-081); this file holds the env-var constant the copy names
 * and assembles the infotip from the copy it is handed.
 *
 * Every claim below was verified against the code rather than paraphrased from a
 * docblock, because the docblock overstates the case. `tax-rate.policy.ts` says
 * "Arm 3 is unreachable while the #2252 gate stands"; that gate is
 * `FiscalRegistrationService.assertEveryLineHasATaxRate`, whose first statement
 * is `if (!isTaxRateEnforced(cmd.taxRateEra)) return;`, and
 * `parseTaxRateStrictEnabled` enables the switch only for the literal string
 * `'true'`. `OL_TAX_RATE_STRICT_ENABLED` is therefore off by default and the
 * fallback IS reachable on an ordinary deployment. Saying otherwise here would
 * reassure an operator about a receipt that really can go out at a rate nobody
 * confirmed.
 *
 * The environment variable is quoted from `TAX_RATE_STRICT_ENV_VAR`
 * (`libs/core/src/sales-documents/domain/types/tax-rate-enforcement.types.ts`),
 * which exists "so the rollout runbook and the code cannot drift on the
 * spelling". `apps/web` cannot import it (#591), so the constant below is a
 * mirror and `scripts/check-eparagony-config-mirror.mjs` fails the build if the
 * two spellings diverge - a sentence naming a variable that no longer switches
 * anything is worse than no sentence. The copy never spells the name itself: it
 * interpolates this constant as `{envVar}`.
 *
 * @module plugins/eparagony/components
 */
import { interpolate } from '../../../shared/i18n';
import type { InfotipDefinition } from '../../../shared/ui/infotip';
import type { getEparagonyMessages } from '../messages';

/**
 * The env var whose absence makes this fallback reachable. Mirrored, guarded -
 * see the module docblock.
 */
export const TAX_RATE_STRICT_ENV_VAR = 'OL_TAX_RATE_STRICT_ENABLED';

export type TaxFallbackCopy = ReturnType<typeof getEparagonyMessages>['taxFallback'];

/** The infotip's notes, in reading order, built from the active language's copy. */
export function buildTaxFallbackHazardNotes(copy: TaxFallbackCopy): readonly InfotipDefinition[] {
  const notes = copy.hazardNotes;
  return [
    { term: notes.whatThisIs.term, text: notes.whatThisIs.text },
    {
      term: notes.intendedUse.term,
      text: notes.intendedUse.text,
      caveat: notes.intendedUse.caveat,
    },
    { term: notes.risk.term, text: notes.risk.text },
    {
      term: notes.whenItFires.term,
      text: interpolate(notes.whenItFires.text, { envVar: TAX_RATE_STRICT_ENV_VAR }),
      caveat: notes.whenItFires.caveat,
    },
  ];
}

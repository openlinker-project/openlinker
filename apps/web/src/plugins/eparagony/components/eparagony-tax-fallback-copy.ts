/**
 * eparagony.pl Tax-Fallback Copy (#3266)
 *
 * The hazard explanation behind `config.defaultTaxRateCode`, kept in one place
 * so the field description and the infotip cannot drift into two accounts of the
 * same rule.
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
 * @module plugins/eparagony/components
 */

export interface EparagonyHazardNote {
  term: string;
  text: string;
  caveat?: string;
}

export const TAX_FALLBACK_INFOTIP_LABEL = 'What the fallback tax rate does, and why it is risky';

/** Shown under the field itself - the short version an operator reads without clicking. */
export const TAX_FALLBACK_FIELD_DESCRIPTION =
  'Leave this empty. It is only used for an order line that arrives with no tax rate at ' +
  'all, and an empty setting makes OpenLinker refuse such a line instead of guessing.';

export const EPARAGONY_TAX_FALLBACK_HAZARD_NOTES: readonly EparagonyHazardNote[] = [
  {
    term: 'What this is',
    text:
      'A slot on your own fiscal device (A to G). It is used for one thing only: an order ' +
      'line that reaches this connection carrying no tax rate. It is you naming your ' +
      'device’s slot — OpenLinker never invents a rate.',
  },
  {
    term: 'How it is meant to work',
    text:
      'The rate belongs to the product, in your shop, and travels with the order line. ' +
      'Leaving this empty is the intended setup: a line with no rate is then refused, with ' +
      'an error naming the order, and you fix the rate in the catalogue.',
    caveat: 'A refused registration is a problem you can fix. An issued receipt is not.',
  },
  {
    term: 'Why setting it is risky',
    text:
      'With a slot set, that line is registered at this rate instead of being refused. A ' +
      'fiscal receipt reaches the buyer and your daily report and cannot be recalled, so a ' +
      'wrong slot puts a wrong tax figure on a document you are answerable for.',
  },
  {
    term: 'When it actually fires',
    text:
      'Only for a line with a blank rate. OpenLinker can refuse those before this connection ' +
      'ever sees them, but that strict check is off unless someone switched it on ' +
      '(OL_TAX_RATE_STRICT_ENABLED).',
    caveat: 'On a standard installation it is off, so this fallback can fire.',
  },
];

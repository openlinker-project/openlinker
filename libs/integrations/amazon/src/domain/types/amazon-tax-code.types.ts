/**
 * Amazon Tax Code Types (#4182)
 *
 * The answer to "which Amazon product tax code carries this rate?".
 *
 * @module libs/integrations/amazon/src/domain/types
 */

export type AmazonTaxCodeResolution =
  | { readonly kind: 'resolved'; readonly code: string }
  | {
      readonly kind: 'none';
      readonly reason: 'no-rate' | 'not-mapped' | 'ambiguous';
      /** The codes that map to the rate, for `ambiguous`. */
      readonly codes?: readonly string[];
    };

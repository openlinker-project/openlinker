/**
 * Connection error types (#3864)
 *
 * @module apps/api/src/integrations/application/services
 */

/** What a refused `config` value must be. Listed in `CONNECTION_CONFIG_INVALID`'s docs. */
export type ConnectionConfigRule =
  | 'object'
  | 'boolean'
  | 'string'
  | 'email'
  | 'one-of'
  | 'min'
  | 'range'
  | 'greater-than-zero'
  | 'below-100'
  | 'required-with'
  | 'set-together'
  | 'known-template'
  | 'shop-only-template';

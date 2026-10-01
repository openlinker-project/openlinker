/**
 * Shoper Connection Config Types
 *
 * Shape of the `Connection.config` JSONB blob for a Shoper connection.
 * Validated at save time by `ShoperConnectionConfigShapeValidatorAdapter`;
 * the rules live in `parseShoperBaseUrl` so the validator and the connection
 * tester cannot disagree about what a valid value is.
 *
 * @module libs/integrations/shoper/src/domain/types
 */

export interface ShoperConnectionConfig {
  /**
   * The shop's own host, e.g. `xxxxx.shoparena.pl`. An `https://` URL naming
   * only that host is accepted too and normalised to the bare host. HTTPS is
   * the only transport: the Bearer token travels on every request.
   */
  readonly baseUrl: string;
}

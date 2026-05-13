/**
 * __Name__ Connection Config Types
 *
 * Shape of the `Connection.config` JSONB blob operators submit when they
 * create a __Name__ connection (e.g., base URL, shop ID, language code,
 * any platform-specific feature flags).
 *
 * Scaffolded with the typical "API base URL" field. Widen as your plugin
 * grows. Validate the shape at create-time with a `class-validator` DTO
 * + a `ConnectionConfigShapeValidatorPort` adapter — see the plugin
 * author guide § Step 7 and PrestaShop's
 * `prestashop-connection-config.dto.ts` for the canonical pattern.
 *
 * @module libs/integrations/__name__/src/domain/types
 */

export interface __Name__ConnectionConfig {
  /**
   * Base URL of the __Name__ instance the adapter talks to.
   * Must include scheme (`https://...`) and exclude trailing slash.
   */
  readonly baseUrl: string;
}

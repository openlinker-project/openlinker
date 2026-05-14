/**
 * __Name__ Credentials Types
 *
 * Shape of the credentials payload encrypted at rest in
 * `integration_credentials`. The factory pulls it via
 * `credentialsResolver.get<__Name__Credentials>(connection.credentialsRef)`
 * inside `createAdapters` — see the plugin author guide § Step 8.
 *
 * Scaffolded with a single `apiKey` field — replace with whatever the
 * vendor's auth model needs (API key, OAuth tokens, mTLS cert paths).
 * Validate the shape with a `ConnectionCredentialsShapeValidatorPort`
 * adapter — see PrestaShop's
 * `prestashop-connection-credentials-shape-validator.adapter.ts` for the
 * canonical pattern.
 *
 * @module libs/integrations/__name__/src/domain/types
 */

export interface __Name__Credentials {
  /** Static API key issued by __Name__'s admin UI. */
  readonly apiKey: string;
}

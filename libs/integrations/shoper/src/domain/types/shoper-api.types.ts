/**
 * Shoper API Types
 *
 * Wire shapes the transport reads. Only what the connection skeleton needs;
 * capability epics widen this file.
 *
 * @module libs/integrations/shoper/src/domain/types
 */

/**
 * Error envelope Shoper returns on 4xx (SPIKE-3638 C3, C4), e.g.
 * `{"error":"unauthorized_client","error_description":"Provided access token is invalid"}`
 * or `{"error":"insufficient_scope", ...}`.
 */
export interface ShoperErrorBody {
  readonly error?: string;
  readonly error_description?: string;
}

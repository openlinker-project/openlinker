/**
 * Raw Body Type Definitions
 *
 * This file provides the RequestWithRawBody interface used by WebhookController
 * to access raw request body bytes for signature verification.
 *
 * Note: Raw body capture is handled at the application level in main.ts using
 * express.json() with verify hook for /webhooks routes. This ensures the verify
 * hook fires before any other body parsing.
 *
 * @module apps/api/src/webhooks/http/middleware
 */
import type { Request } from 'express';

/**
 * Extended Request interface to include rawBody
 */
export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * RequestWithRawBody Interface
 *
 * This interface extends Express Request to include rawBody, which is set by
 * the express.json() verify hook in main.ts for /webhooks routes.
 *
 * Note: The RawBodyMiddleware class has been removed. Raw body capture is now
 * handled at the application level in main.ts to ensure the verify hook fires
 * before any other body parsing.
 */

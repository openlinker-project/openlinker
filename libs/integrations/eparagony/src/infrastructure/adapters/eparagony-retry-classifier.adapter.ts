/**
 * eparagony.pl Retry Classifier
 *
 * Answers the worker runner's "is this error non-retryable?" question for this
 * plugin's own exception hierarchy (#581). Without it the registry defaults every
 * unknown error to retryable, and a blind re-run of a registration whose outcome
 * is unknown is exactly the double-registration ADR-042 exists to prevent.
 *
 * The classification is FISCAL, not merely operational:
 *
 *   - `EparagonyConfigException` - NON-RETRYABLE. Nothing crossed the boundary
 *     and nothing will until the operator fixes the connection or the order.
 *   - `EparagonyApiError` with `failureMode: 'in-doubt'` (`422`, `429`, `5xx`) -
 *     NON-RETRYABLE. A document may already exist; the runner must not re-drive
 *     it. Note this diverges from the usual "429 is transient, back off and
 *     retry" reading, deliberately: the transport already retried the rate limit
 *     in-request, so an error that survived to the runner is one whose create
 *     semantics we cannot establish.
 *   - `EparagonyApiError` with `failureMode: 'rejected'` - NON-RETRYABLE.
 *     Deterministic; re-running the same job burns capacity for nothing.
 *   - `EparagonyNetworkError` - NON-RETRYABLE. Always in-doubt by construction.
 *
 * So every error this plugin owns is non-retryable, and that is the point:
 * re-attempting a fiscal registration is a decision core makes from the persisted
 * record's status (which distinguishes `rejected` from `in-doubt`), never one the
 * job runner makes from an exception.
 *
 * Like every sibling classifier this one recognises ONLY its own exception types
 * and abstains for everything else - the registry OR-aggregates across plugins
 * with no platform scoping, so a catch-all `true` would make every other
 * plugin's transient error terminal.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';

import { EparagonyApiError } from '../../domain/exceptions/eparagony-api.error';
import { EparagonyConfigException } from '../../domain/exceptions/eparagony-config.exception';
import { EparagonyNetworkError } from '../../domain/exceptions/eparagony-network.error';

export class EparagonyRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return (
      cause instanceof EparagonyApiError ||
      cause instanceof EparagonyNetworkError ||
      cause instanceof EparagonyConfigException
    );
  }
}

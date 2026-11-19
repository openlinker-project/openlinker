/**
 * Amazon Notification Provisioning (#4179)
 *
 * The "Configure webhooks" action for an Amazon connection: registers the
 * connection's SQS queue with Amazon's Notifications API and subscribes it to
 * `ORDER_CHANGE`. Idempotent, so it can be run again after any change:
 *
 *   1. Destination: `GET /notifications/v1/destinations`, reuse the one whose
 *      SQS ARN is the queue's, else `POST` one. Both need a grantless token.
 *   2. Subscription: `GET /notifications/v1/subscriptions/ORDER_CHANGE`; a
 *      404 means none, so `POST` one for that destination, filtered to order
 *      status and buyer-requested changes. A subscription pointing at another
 *      destination is left alone and reported, since replacing it could cut
 *      off a queue the seller still uses.
 *
 * A connection without a queue is reported, not failed. So are Amazon's two
 * routine refusals, as a warning naming the fix rather than a raw error: LWA
 * refusing the grantless scope (a Sandbox-status app, #2881 Evidence #9 /
 * #32, or rejected credentials), a 403 from the Notifications API (the app
 * lacks the Notifications role), and a connection config or credentials the
 * factory cannot use. Anything else propagates.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters
 * @implements {WebhookProvisioningPort}
 */
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type {
  CredentialsResolverPort,
  WebhookProvisioningPort,
  WebhookProvisioningResult,
} from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import type { IAmazonAdapterFactory } from '../../application/interfaces/amazon-adapter.factory.interface';
import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';
import { AmazonAuthenticationError } from '../../domain/exceptions/amazon-authentication.error';
import { AmazonConfigException } from '../../domain/exceptions/amazon-config.exception';
import type { AmazonSpApiClient } from '../http/amazon-spapi-client';

const DESTINATIONS_PATH = '/notifications/v1/destinations';
const ORDER_CHANGE_SUBSCRIPTION_PATH = '/notifications/v1/subscriptions/ORDER_CHANGE';
const PAYLOAD_VERSION = '1.0';
const ORDER_CHANGE_TYPES = ['OrderStatusChange', 'BuyerRequestedChange'];

interface Destination {
  readonly destinationId: string;
  readonly name?: string;
  readonly resource?: { readonly sqs?: { readonly arn?: string } };
}

interface Subscription {
  readonly subscriptionId: string;
  readonly destinationId: string;
}

export class AmazonNotificationProvisioningAdapter implements WebhookProvisioningPort {
  constructor(
    private readonly connections: ConnectionPort,
    private readonly credentialsResolver: CredentialsResolverPort,
    private readonly factory: IAmazonAdapterFactory,
    private readonly http: HttpTransportFactoryPort,
  ) {}

  async install(connectionId: string): Promise<WebhookProvisioningResult> {
    const connection = await this.connections.get(connectionId);
    try {
      const resolution = await this.factory.resolve(
        connection,
        this.credentialsResolver,
        this.http.forConnection(connection),
      );
      const queue = resolution.config.notificationQueue;
      if (queue === undefined) {
        return {
          webhooksConfigured: false,
          testPingTriggered: false,
          warning: 'Set the notification queue URL on the connection first.',
        };
      }

      const destinationId = await this.findOrCreateDestination(resolution.notificationsClient, queue.arn, connectionId);
      const existing = await this.readOrderChangeSubscription(resolution.client);
      if (existing === null) {
        await resolution.client.post(ORDER_CHANGE_SUBSCRIPTION_PATH, {
          payloadVersion: PAYLOAD_VERSION,
          destinationId,
          processingDirective: {
            eventFilter: { eventFilterType: 'ORDER_CHANGE', orderChangeTypes: ORDER_CHANGE_TYPES },
          },
        });
        return { webhooksConfigured: true, testPingTriggered: false };
      }
      if (existing.destinationId !== destinationId) {
        return {
          webhooksConfigured: false,
          testPingTriggered: false,
          warning:
            'This seller already has an ORDER_CHANGE subscription for another destination. ' +
            'Delete it in Amazon to send order changes to this queue.',
        };
      }
      return { webhooksConfigured: true, testPingTriggered: false };
    } catch (error) {
      const refusal = describeRefusal(error);
      if (refusal === null) {
        throw error;
      }
      return { webhooksConfigured: false, testPingTriggered: false, warning: refusal };
    }
  }

  private async findOrCreateDestination(
    client: AmazonSpApiClient,
    arn: string,
    connectionId: string,
  ): Promise<string> {
    const list = await client.get<{ payload?: Destination[] }>(DESTINATIONS_PATH);
    const match = (list.data.payload ?? []).find((destination) => destination.resource?.sqs?.arn === arn);
    if (match !== undefined) {
      return match.destinationId;
    }
    const created = await client.post<{ payload?: Destination }>(DESTINATIONS_PATH, {
      name: `openlinker-${connectionId}`,
      resourceSpecification: { sqs: { arn } },
    });
    if (created.data.payload?.destinationId === undefined) {
      throw new AmazonApiError(created.status, 'NoDestinationId', 'createDestination returned no destination id', created.requestId);
    }
    return created.data.payload.destinationId;
  }

  private async readOrderChangeSubscription(client: AmazonSpApiClient): Promise<Subscription | null> {
    try {
      const response = await client.get<{ payload?: Subscription }>(ORDER_CHANGE_SUBSCRIPTION_PATH, {
        payloadVersion: PAYLOAD_VERSION,
      });
      return response.data.payload ?? null;
    } catch (error) {
      if (error instanceof AmazonApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }
}

/** The operator-facing sentence for a routine Amazon refusal, or null for anything else. */
function describeRefusal(error: unknown): string | null {
  if (error instanceof AmazonConfigException) {
    return error.message;
  }
  if (error instanceof AmazonAuthenticationError) {
    return (
      'Amazon refused the token for its Notifications API. An app still in Sandbox status cannot ' +
      'register a queue; otherwise check the client id and secret.'
    );
  }
  if (error instanceof AmazonApiError && error.statusCode === 403) {
    return 'Amazon refused the call: the app lacks the Notifications role. Add it in Developer Central, then authorize the app again.';
  }
  return null;
}

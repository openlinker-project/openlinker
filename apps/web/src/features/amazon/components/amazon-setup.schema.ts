/**
 * Amazon Setup Form Schema (#4186)
 *
 * Fields of the guided Amazon connection form and their mapping to the create
 * payload. Each rule is no stricter than the backend's `parseAmazonConfig` /
 * `parseAmazonCredentials`, which validate the same values on save.
 *
 * The role is chosen up front. Today only the sales channel role exists
 * (orders and offers); the catalogue master role arrives with #4182. The
 * manifest enables nothing by default, so the payload names the capabilities.
 *
 * Validation messages are KEYS of `amazon.setup.errors`, so the schema is
 * static and the form translates what it shows.
 *
 * @module features/amazon/components
 */
import { z } from 'zod';
import type { CoreCapability, CreateConnectionInput } from '../../connections';
import {
  AmazonEnvironmentValues,
  AmazonRegionValues,
  findMarketplace,
  isSingleMarketplaceRegion,
} from '../lib/amazon-marketplaces';

export const AMAZON_ADAPTER_KEY = 'amazon.spapi.v1';

export const AmazonSetupErrorKeyValues = [
  'required',
  'marketplaceRequired',
  'marketplaceOtherRegion',
  'marketplaceSingle',
  'sellerIdInvalid',
  'sellerIdRequired',
  'capabilityRequired',
  'queueUrlInvalid',
  'awsKeysPaired',
] as const;
export type AmazonSetupErrorKey = (typeof AmazonSetupErrorKeyValues)[number];

const SELLER_ID = /^[A-Z0-9]{8,20}$/;
export const SQS_QUEUE_URL = /^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[A-Za-z0-9_-]{1,80}(\.fifo)?$/;

export const amazonSetupSchema = z
  .object({
    name: z.string().trim().min(1, 'required'),
    region: z.enum(AmazonRegionValues),
    environment: z.enum(AmazonEnvironmentValues),
    marketplaceIds: z.array(z.string()),
    orders: z.boolean(),
    offers: z.boolean(),
    sellerId: z.string().trim().toUpperCase(),
    clientId: z.string().trim().min(1, 'required'),
    clientSecret: z.string().trim().min(1, 'required'),
    refreshToken: z.string().trim().min(1, 'required'),
    notificationQueueUrl: z.string().trim(),
    awsAccessKeyId: z.string().trim(),
    awsSecretAccessKey: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    const fail = (path: string, message: AmazonSetupErrorKey): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    if (values.marketplaceIds.length === 0) {
      fail('marketplaceIds', 'marketplaceRequired');
    } else if (values.marketplaceIds.some((id) => findMarketplace(id)?.region !== values.region)) {
      fail('marketplaceIds', 'marketplaceOtherRegion');
    } else if (isSingleMarketplaceRegion(values.region) && values.marketplaceIds.length > 1) {
      fail('marketplaceIds', 'marketplaceSingle');
    }
    if (!values.orders && !values.offers) {
      fail('orders', 'capabilityRequired');
    }
    if (values.sellerId !== '' && !SELLER_ID.test(values.sellerId)) {
      fail('sellerId', 'sellerIdInvalid');
    } else if (values.offers && values.sellerId === '') {
      fail('sellerId', 'sellerIdRequired');
    }
    if (values.notificationQueueUrl !== '' && !SQS_QUEUE_URL.test(values.notificationQueueUrl)) {
      fail('notificationQueueUrl', 'queueUrlInvalid');
    }
    if ((values.awsAccessKeyId === '') !== (values.awsSecretAccessKey === '')) {
      fail('awsAccessKeyId', 'awsKeysPaired');
    }
  });

export type AmazonSetupFormValues = z.input<typeof amazonSetupSchema>;
export type AmazonSetupFormSubmission = z.output<typeof amazonSetupSchema>;

export const AMAZON_SETUP_DEFAULT_VALUES: AmazonSetupFormValues = {
  name: '',
  region: 'eu',
  environment: 'production',
  marketplaceIds: [],
  orders: true,
  offers: true,
  sellerId: '',
  clientId: '',
  clientSecret: '',
  refreshToken: '',
  notificationQueueUrl: '',
  awsAccessKeyId: '',
  awsSecretAccessKey: '',
};

export function toCreateConnectionInput(values: AmazonSetupFormSubmission): CreateConnectionInput {
  const enabledCapabilities: CoreCapability[] = [
    ...(values.orders ? (['OrderSource'] as const) : []),
    ...(values.offers ? (['OfferManager'] as const) : []),
  ];
  return {
    name: values.name,
    platformType: 'amazon',
    adapterKey: AMAZON_ADAPTER_KEY,
    config: {
      region: values.region,
      environment: values.environment,
      marketplaceIds: values.marketplaceIds,
      ...(values.sellerId ? { sellerId: values.sellerId } : {}),
      ...(values.notificationQueueUrl ? { notificationQueueUrl: values.notificationQueueUrl } : {}),
    },
    credentials: {
      clientId: values.clientId,
      clientSecret: values.clientSecret,
      refreshToken: values.refreshToken,
      ...(values.awsAccessKeyId
        ? { awsAccessKeyId: values.awsAccessKeyId, awsSecretAccessKey: values.awsSecretAccessKey }
        : {}),
    },
    enabledCapabilities,
  };
}

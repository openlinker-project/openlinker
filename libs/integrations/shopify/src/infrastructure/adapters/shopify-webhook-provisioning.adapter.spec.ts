import { planShopifyWebhooks, shopifyWebhookTopicsFor } from './shopify-webhook-provisioning.adapter';

const PATH = '/webhooks/shopify/conn-1';
const URI = `https://ol.example.com${PATH}`;

describe('shopifyWebhookTopicsFor', () => {
  it('should subscribe order and product topics when both capabilities are enabled', () => {
    expect(shopifyWebhookTopicsFor(['OrderSource', 'ProductMaster'])).toEqual([
      'ORDERS_CREATE',
      'ORDERS_UPDATED',
      'ORDERS_CANCELLED',
      'PRODUCTS_CREATE',
      'PRODUCTS_UPDATE',
      'PRODUCTS_DELETE',
    ]);
  });

  it('should subscribe nothing when neither capability is enabled', () => {
    expect(shopifyWebhookTopicsFor(['InventoryMaster'])).toEqual([]);
  });
});

describe('planShopifyWebhooks', () => {
  it('should create only the missing topics when some are already subscribed to the current uri', () => {
    const plan = planShopifyWebhooks(
      [{ id: 'gid://shopify/WebhookSubscription/1', topic: 'ORDERS_CREATE', uri: URI }],
      ['ORDERS_CREATE', 'ORDERS_UPDATED'],
      URI,
      PATH,
    );
    expect(plan).toEqual({ toCreate: ['ORDERS_UPDATED'], toDelete: [] });
  });

  it('should replace a subscription when it points at an old callback base', () => {
    const stale = { id: 'gid://shopify/WebhookSubscription/2', topic: 'ORDERS_CREATE', uri: `https://old.example.com${PATH}` };
    const plan = planShopifyWebhooks([stale], ['ORDERS_CREATE'], URI, PATH);
    expect(plan).toEqual({ toCreate: ['ORDERS_CREATE'], toDelete: [stale] });
  });

  it('should delete our subscription when its topic is no longer needed', () => {
    const extra = { id: 'gid://shopify/WebhookSubscription/3', topic: 'PRODUCTS_UPDATE', uri: URI };
    expect(planShopifyWebhooks([extra], ['ORDERS_CREATE'], URI, PATH).toDelete).toEqual([extra]);
  });

  it('should leave another connection subscription alone', () => {
    const foreign = {
      id: 'gid://shopify/WebhookSubscription/4',
      topic: 'ORDERS_CREATE',
      uri: 'https://ol.example.com/webhooks/shopify/conn-2',
    };
    expect(planShopifyWebhooks([foreign], ['ORDERS_CREATE'], URI, PATH).toDelete).toEqual([]);
  });
});

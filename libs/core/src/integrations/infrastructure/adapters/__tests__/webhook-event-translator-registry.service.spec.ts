/**
 * Webhook Event Translator Registry Service Unit Tests
 *
 * @module libs/core/src/integrations/infrastructure/adapters/__tests__
 */
import { WebhookEventTranslatorRegistryService } from '../webhook-event-translator-registry.service';
import type { WebhookEventTranslatorPort } from '../../../domain/ports/webhook-event-translator.port';

describe('WebhookEventTranslatorRegistryService', () => {
  let registry: WebhookEventTranslatorRegistryService;
  const translator: WebhookEventTranslatorPort = { translate: () => null };

  beforeEach(() => {
    registry = new WebhookEventTranslatorRegistryService();
  });

  it('should return the registered translator by adapterKey', () => {
    registry.register('prestashop.webservice.v1', translator);

    expect(registry.get('prestashop.webservice.v1')).toBe(translator);
    expect(registry.has('prestashop.webservice.v1')).toBe(true);
  });

  it('should return undefined for an unregistered adapterKey', () => {
    expect(registry.get('unknown.adapter.v1')).toBeUndefined();
    expect(registry.has('unknown.adapter.v1')).toBe(false);
  });

  it('should overwrite a duplicate adapterKey registration (last wins)', () => {
    const second: WebhookEventTranslatorPort = { translate: () => null };
    registry.register('prestashop.webservice.v1', translator);
    registry.register('prestashop.webservice.v1', second);

    expect(registry.get('prestashop.webservice.v1')).toBe(second);
  });
});

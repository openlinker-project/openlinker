/**
 * Webhook Provisioning Registry Service — Unit Tests
 *
 * Pins the registry's own contract: register / get / has, and the
 * overwrite-on-duplicate semantics that sibling registries
 * (`ConnectionTesterRegistryService`, `AdapterFactoryResolverService`)
 * also exhibit. Regressions in this shape would silently route
 * `ConnectionService.installWebhooks` to the wrong adapter, so the spec
 * exists even though the surface is trivial (#583).
 *
 * @module libs/core/src/integrations/infrastructure/adapters/__tests__
 */
import { WebhookProvisioningRegistryService } from '../webhook-provisioning-registry.service';
import { WebhookProvisioningPort } from '../../../domain/ports/webhook-provisioning.port';

describe('WebhookProvisioningRegistryService', () => {
  let registry: WebhookProvisioningRegistryService;

  const makeProvisioner = (label: string): WebhookProvisioningPort => ({
    install: jest.fn().mockResolvedValue({
      webhooksConfigured: true,
      testPingTriggered: true,
      warning: label,
    }),
  });

  beforeEach(() => {
    registry = new WebhookProvisioningRegistryService();
  });

  describe('register / get', () => {
    it('returns the registered provisioner by adapterKey', () => {
      const provisioner = makeProvisioner('a');
      registry.register('foo.v1', provisioner);

      expect(registry.get('foo.v1')).toBe(provisioner);
    });

    it('returns undefined for unknown adapterKey', () => {
      expect(registry.get('not-registered')).toBeUndefined();
    });

    it('keeps registrations isolated per adapterKey', () => {
      const a = makeProvisioner('a');
      const b = makeProvisioner('b');
      registry.register('foo.v1', a);
      registry.register('bar.v1', b);

      expect(registry.get('foo.v1')).toBe(a);
      expect(registry.get('bar.v1')).toBe(b);
    });

    it('overwrites silently when the same adapterKey is registered twice', () => {
      // Mirrors ConnectionTesterRegistryService — integration modules
      // register exactly once at boot, so a collision is a programming
      // bug, not a runtime concern. The contract is "last writer wins".
      const first = makeProvisioner('first');
      const second = makeProvisioner('second');
      registry.register('foo.v1', first);
      registry.register('foo.v1', second);

      expect(registry.get('foo.v1')).toBe(second);
    });
  });

  describe('has', () => {
    it('returns true when the adapterKey is registered', () => {
      registry.register('foo.v1', makeProvisioner('a'));
      expect(registry.has('foo.v1')).toBe(true);
    });

    it('returns false when the adapterKey is not registered', () => {
      expect(registry.has('foo.v1')).toBe(false);
    });
  });
});

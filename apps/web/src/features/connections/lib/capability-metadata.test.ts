/**
 * Capability Metadata Tests
 *
 * Unit coverage for the shared capability exclusivity helpers consumed by the
 * setup wizards and the ConnectionCapabilitiesPanel.
 */
import { describe, expect, it } from 'vitest';
import {
  capabilityConflictMessage,
  getCapabilityConflict,
  hasCapabilityConflict,
} from './capability-metadata';

describe('getCapabilityConflict', () => {
  it('should report InventoryMaster as the blocker for OfferManager when selected', () => {
    expect(getCapabilityConflict(['InventoryMaster'], 'OfferManager')).toBe('InventoryMaster');
  });

  it('should report OfferManager as the blocker for InventoryMaster when selected', () => {
    expect(getCapabilityConflict(new Set(['OfferManager']), 'InventoryMaster')).toBe(
      'OfferManager',
    );
  });

  it('should return null when the counterpart is not selected', () => {
    expect(getCapabilityConflict(['ProductMaster', 'OrderSource'], 'OfferManager')).toBeNull();
  });

  it('should return null for capabilities outside any exclusivity pair', () => {
    expect(getCapabilityConflict(['InventoryMaster', 'OfferManager'], 'ProductMaster')).toBeNull();
  });
});

describe('hasCapabilityConflict', () => {
  it('should detect the InventoryMaster/OfferManager pair', () => {
    expect(hasCapabilityConflict(['ProductMaster', 'InventoryMaster', 'OfferManager'])).toBe(true);
  });

  it('should pass a set containing only one side of the pair', () => {
    expect(hasCapabilityConflict(['InventoryMaster', 'OrderSource'])).toBe(false);
    expect(hasCapabilityConflict(['OfferManager', 'ProductPublisher'])).toBe(false);
  });

  it('should pass an empty set', () => {
    expect(hasCapabilityConflict([])).toBe(false);
  });
});

describe('capabilityConflictMessage', () => {
  it('should name the conflicting capability', () => {
    expect(capabilityConflictMessage('InventoryMaster')).toContain(
      'Unavailable while InventoryMaster is selected',
    );
  });
});

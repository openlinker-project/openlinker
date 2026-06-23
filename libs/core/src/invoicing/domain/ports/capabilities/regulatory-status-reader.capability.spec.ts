/**
 * Unit tests for the `RegulatoryStatusReader` ADR-002 sub-capability guard
 * (`isRegulatoryStatusReader`).
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
describe('isRegulatoryStatusReader', () => {
  it.todo('returns true for an Invoicing adapter that implements readRegulatoryStatus');
  it.todo('returns false for an Invoicing adapter without readRegulatoryStatus');
  it.todo('returns false when readRegulatoryStatus is present but not a function');
});

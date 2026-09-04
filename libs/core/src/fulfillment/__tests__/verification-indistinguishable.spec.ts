/**
 * A hand-confirmed unit is indistinguishable from a scanned one (#2418, D20)
 *
 * Spec § 2.5 story E4: *"Recorded identically to a scan."* Decision D20 gives
 * the reason, and it is not tidiness — marking a hand-confirmed line creates a
 * stigma, and stigma drives the workaround the system **cannot see**: the packer
 * scans a second unit of the same SKU twice, after which the parcel closes
 * looking perfectly verified. The cost of D20 is weaker dispute evidence on the
 * hand-confirmed line, accepted knowingly; the cost of marking it is a false
 * record nobody can detect.
 *
 * So this is asserted rather than reviewed for, on the two surfaces where a
 * distinction could physically be stored:
 *
 * 1. **The ledger's column list.** No `source`, no `barcode`, no `manual`, no
 *    `confirmationMethod` — and the assertion is over the WHOLE list, so adding
 *    one fails here rather than passing a deny-list somebody forgot to extend.
 * 2. **The write input's shape.** `RecordParcelVerificationInput` and
 *    `VerifyUnitInput` name a LINE. A scan and a hand-confirm reach the service
 *    through the same method with the same arguments, so recording them
 *    differently is not expressible.
 *
 * What this canNOT see, stated so the boundary is a decision rather than an
 * assumption: the REQUEST necessarily differs above the API layer, because the
 * browser resolves a scanned barcode to a line and a hand-confirm names one
 * directly. Nothing persists that difference and no audit records it — but this
 * spec proves the storage half only, and the FE half is proved by its own test.
 *
 * @module libs/core/src/fulfillment/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getMetadataArgsStorage } from 'typeorm';

import { FulfillmentWorkVerificationOrmEntity } from '../infrastructure/persistence/entities/fulfillment-work-verification.orm-entity';

/** Every column the ledger carries, and nothing else. */
const EXPECTED_COLUMNS = [
  'id',
  'fulfillmentWorkId',
  'workLineId',
  'gestureId',
  'verifiedByUserId',
  'verifiedAt',
  'voidedAt',
  'voidedByUserId',
].sort();

function declaredColumns(): string[] {
  const storage = getMetadataArgsStorage();
  const names = storage.columns
    .filter((column) => column.target === FulfillmentWorkVerificationOrmEntity)
    .map((column) => column.propertyName);
  // Non-vacuity: a walk that matched nothing would pass every assertion below
  // forever, which is the shape this repository has been bitten by before.
  expect(names.length).toBeGreaterThan(0);
  return names.sort();
}

describe('the verification ledger cannot record HOW a unit was confirmed (#2418, D20)', () => {
  it('carries exactly the columns it is supposed to and no others', () => {
    expect(declaredColumns()).toEqual(EXPECTED_COLUMNS);
  });

  it.each([
    'source',
    'barcode',
    'scanned',
    'manual',
    'manuallyConfirmed',
    'confirmationMethod',
    'method',
    'input',
  ])('has no `%s` column', (forbidden) => {
    // Redundant with the equality above, deliberately: this is the assertion
    // whose FAILURE MESSAGE names the decision, so somebody adding one of these
    // reads why rather than only that a list changed.
    expect(declaredColumns()).not.toContain(forbidden);
  });

  it('has no quantity column — one row is one physical gesture', () => {
    // A quantity would let a single row stand for three units and destroy the
    // property `gestureId` exists to give: one action recorded once, and a
    // legitimate second scan recorded as a second unit (story G3).
    expect(declaredColumns()).not.toContain('quantity');
  });
});

describe('the write INPUTS cannot say how a unit was confirmed (#2418, D20)', () => {
  /**
   * Surface (2). Asserted over the DECLARATIONS rather than over a value,
   * because these are types: they erase at build time, so there is no object to
   * inspect and `keyof` cannot be read at runtime. The declarations are what a
   * reviewer would check by eye, and this is that check made mechanical.
   *
   * Comments are stripped first — both files explain at length why they name a
   * line and not a barcode, and matching that explanation would make the guard
   * unpassable. That is the trap `bench-never-issues.spec.ts` fell into on its
   * first run.
   */
  const declarationOf = (file: string, name: string): string => {
    const source = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    const start = source.indexOf(`export interface ${name} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  const PORT = join(__dirname, '..', 'domain', 'ports', 'fulfillment-work-repository.port.ts');
  const TYPES = join(__dirname, '..', 'domain', 'types', 'fulfillment-verification.types.ts');

  it.each([
    [PORT, 'RecordParcelVerificationInput'],
    [TYPES, 'VerifyUnitInput'],
  ])('%s#%s names a LINE and nothing about how it was confirmed', (file, name) => {
    const declaration = declarationOf(file, name);
    expect(declaration).toContain('workLineId');
    for (const forbidden of ['barcode', 'source', 'scanned', 'manual', 'confirmationMethod']) {
      expect(
        declaration.includes(forbidden)
          ? `${name} declares \`${forbidden}\`. Decision D20: a hand-confirmed unit is recorded ` +
              'IDENTICALLY to a scanned one, and the way that is guaranteed rather than promised ' +
              'is that the difference cannot be expressed. Marking it creates a stigma, and ' +
              'stigma drives the workaround the system cannot see.'
          : null
      ).toBeNull();
    }
  });
});
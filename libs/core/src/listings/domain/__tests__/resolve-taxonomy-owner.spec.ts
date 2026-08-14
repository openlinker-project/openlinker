/**
 * Taxonomy Owner Resolution — unit tests (#2063)
 *
 * Pins the identity contract the destination-taxonomy read model keys on: an
 * owner is DECLARED, never inferred from `platformType`. The two most valuable
 * assertions here are negative ones — that an undeclared adapter resolves to
 * `null` (the fail-safe replacing #1979's inference fallback), and that two
 * environments of one platform do NOT collapse onto one scope.
 *
 * @module libs/core/src/listings/domain/__tests__
 */
import { resolveTaxonomyOwner } from '../resolve-taxonomy-owner';
import type { OfferManagerPort } from '../ports/offer-manager.port';
import type { TaxonomyOwner } from '../types/taxonomy-owner.types';

const baseAdapter = (): OfferManagerPort =>
  ({ updateOfferQuantity: jest.fn() }) as unknown as OfferManagerPort;

const withIdentity = (identity: TaxonomyOwner): OfferManagerPort =>
  Object.assign(baseAdapter(), { getTaxonomyIdentity: () => identity });

const withBorrow = (owner: TaxonomyOwner): OfferManagerPort =>
  Object.assign(baseAdapter(), { getBorrowedTaxonomy: () => owner });

const withBrowse = (adapter: OfferManagerPort): OfferManagerPort =>
  Object.assign(adapter, { fetchCategories: jest.fn() });

describe('resolveTaxonomyOwner', () => {
  it('should return the declared identity when the adapter is a TaxonomyIdentityProvider', () => {
    expect(resolveTaxonomyOwner(withIdentity('allegro'))).toBe('allegro');
  });

  it('should return the owner it borrows when the adapter is a TaxonomyBorrower', () => {
    expect(resolveTaxonomyOwner(withBorrow('allegro'))).toBe('allegro');
  });

  it('should prefer the borrowed owner when the adapter declares both', () => {
    // A borrower reads the OWNER's rows; minting its own scope would fork the
    // tree and strand every mapping authored against the owner.
    const both = Object.assign(withIdentity('allegro:sandbox'), {
      getBorrowedTaxonomy: (): TaxonomyOwner => 'allegro',
    });

    expect(resolveTaxonomyOwner(both)).toBe('allegro');
  });

  it('should return null when the adapter declares no taxonomy identity', () => {
    expect(resolveTaxonomyOwner(baseAdapter())).toBeNull();
  });

  it('should return null when the adapter can browse but declares no identity', () => {
    // The #1979 fallback resolved this from `platformType`. Deleting it is the
    // fix: writing rows under a guessed owner is a data migration to undo,
    // whereas skipping the sync is recoverable by declaring the capability.
    expect(resolveTaxonomyOwner(withBrowse(baseAdapter()))).toBeNull();
  });

  it('should resolve two environments of one platform to different scopes', () => {
    // The #2063 defect in one assertion: these collapsing onto one value is what
    // let a sandbox sync delete production's tree on its watermark sweep.
    expect(resolveTaxonomyOwner(withIdentity('allegro:sandbox'))).not.toBe(
      resolveTaxonomyOwner(withIdentity('allegro')),
    );
  });
});

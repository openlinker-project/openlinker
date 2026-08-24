/**
 * Update-Offer-Fields DTO validation tests
 *
 * Pins the boundary rule ADR-063 states: there is no OpenLinker-side tax-rate
 * field to type into. The neutral `OfferFieldUpdate.taxRate` exists and both
 * marketplace adapters write it, but its producer must be OpenLinker
 * propagating the shop catalogue's rate - so this route must reject a `taxRate`
 * key instead of patching an operator-typed value onto a live offer.
 *
 * The rejection comes from the global pipe's `forbidNonWhitelisted`, which is
 * why the helper below validates with the same flags `main.ts` sets.
 *
 * @module apps/api/src/listings/http/dto
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateOfferFieldsDto } from './update-offer-fields.dto';

async function errorsFor(body: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateOfferFieldsDto, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  const collect = (es: typeof errors): string[] =>
    es.flatMap((e) => [
      ...Object.keys(e.constraints ?? {}),
      ...(e.children ? collect(e.children) : []),
    ]);
  return collect(errors);
}

describe('UpdateOfferFieldsDto', () => {
  it('should accept a title-only update when no tax rate is supplied', async () => {
    expect(await errorsFor({ title: 'A new title' })).toEqual([]);
  });

  it('should accept a price-only update when no tax rate is supplied', async () => {
    expect(await errorsFor({ price: { amount: '99.99', currency: 'PLN' } })).toEqual([]);
  });

  it('should reject a taxRate key because the rate is never operator-typed (ADR-063)', async () => {
    const errs = await errorsFor({ title: 'A new title', taxRate: '23' });
    expect(errs).toContain('whitelistValidation');
  });

  it('should reject a rate-only body rather than treating the rate as a field', async () => {
    expect(await errorsFor({ taxRate: '23' })).toContain('whitelistValidation');
  });

  it('should reject a fractional rate spelling for the same reason as any other rate', async () => {
    expect(await errorsFor({ taxRate: '0.23' })).toContain('whitelistValidation');
  });

  it('should strip taxRate from the payload the controller reads', async () => {
    const dto = plainToInstance(UpdateOfferFieldsDto, { title: 'A new title', taxRate: '23' });
    await validate(dto, { whitelist: true });
    expect((dto as Record<string, unknown>)['taxRate']).toBeUndefined();
  });
});

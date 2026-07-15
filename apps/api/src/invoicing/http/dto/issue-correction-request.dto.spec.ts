/**
 * Issue Correction Request DTO — validation spec
 *
 * Exercises the class-validator constraints on `IssueCorrectionRequestDto`,
 * in particular the duplicate-`originalLineNumber` rejection (#1297 review):
 * duplicates would silently last-write-win in the persisted "after" snapshot
 * while the provider may compute something else.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { IssueCorrectionRequestDto } from './issue-correction-request.dto';

function buildDto(lines: Array<Record<string, unknown>>): IssueCorrectionRequestDto {
  return plainToInstance(IssueCorrectionRequestDto, { reason: 'partial return', lines });
}

describe('IssueCorrectionRequestDto', () => {
  it('should pass validation when each line targets a distinct originalLineNumber', async () => {
    const dto = buildDto([
      { originalLineNumber: 1, newQuantity: 2 },
      { originalLineNumber: 2, newUnitPriceGross: 9.99 },
    ]);

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should reject the request when two lines repeat the same originalLineNumber', async () => {
    const dto = buildDto([
      { originalLineNumber: 1, newQuantity: 2 },
      { originalLineNumber: 1, newUnitPriceGross: 9.99 },
    ]);

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toMatchObject({
      uniqueOriginalLineNumbers: 'Correction lines must not repeat the same originalLineNumber',
    });
  });

  it('should reject a line that changes neither quantity nor price', async () => {
    const dto = buildDto([{ originalLineNumber: 1 }]);

    const errors = await validate(dto);

    const nested = errors.flatMap((e) => e.children ?? []);
    expect(JSON.stringify([errors, nested])).toContain('hasCorrectionDelta');
  });

  describe('reason (#1582)', () => {
    it('should reject a correction with an empty reason', async () => {
      const dto = plainToInstance(IssueCorrectionRequestDto, {
        reason: '',
        lines: [{ originalLineNumber: 1, newQuantity: 2 }],
      });

      const errors = await validate(dto);

      const reasonError = errors.find((e) => e.property === 'reason');
      expect(reasonError?.constraints).toHaveProperty('isNotEmpty');
    });

    it('should reject a correction whose reason is only whitespace (trimmed)', async () => {
      const dto = plainToInstance(IssueCorrectionRequestDto, {
        reason: '   ',
        lines: [{ originalLineNumber: 1, newQuantity: 2 }],
      });

      const errors = await validate(dto);

      const reasonError = errors.find((e) => e.property === 'reason');
      expect(reasonError?.constraints).toHaveProperty('isNotEmpty');
    });

    it('should reject a correction with a missing reason', async () => {
      const dto = plainToInstance(IssueCorrectionRequestDto, {
        lines: [{ originalLineNumber: 1, newQuantity: 2 }],
      });

      const errors = await validate(dto);

      expect(errors.some((e) => e.property === 'reason')).toBe(true);
    });

    it('should trim the reason before it reaches the command', async () => {
      const dto = plainToInstance(IssueCorrectionRequestDto, {
        reason: '  wrong NIP  ',
        lines: [{ originalLineNumber: 1, newQuantity: 2 }],
      });

      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
      expect(dto.reason).toBe('wrong NIP');
    });
  });

  describe('buyerOverride (#1582)', () => {
    const validBuyer = {
      name: 'Acme Sp. z o.o.',
      taxId: { scheme: 'pl-nip', value: '5252248481' },
      address: {
        line1: 'ul. Testowa 1',
        line2: null,
        city: 'Warszawa',
        postalCode: '00-001',
        countryIso2: 'PL',
      },
      type: 'company',
    };

    it('should accept a well-formed buyer override', async () => {
      const dto = plainToInstance(IssueCorrectionRequestDto, {
        reason: 'wrong NIP',
        lines: [{ originalLineNumber: 1, newQuantity: 1 }],
        buyerOverride: validBuyer,
      });

      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
    });

    it('should reject a buyer override with an invalid buyer type', async () => {
      const dto = plainToInstance(IssueCorrectionRequestDto, {
        reason: 'wrong NIP',
        lines: [{ originalLineNumber: 1, newQuantity: 1 }],
        buyerOverride: { ...validBuyer, type: 'not-a-type' },
      });

      const errors = await validate(dto);

      expect(errors.some((e) => e.property === 'buyerOverride')).toBe(true);
    });

    it('should reject a buyer override missing the address', async () => {
      const noAddress = { name: validBuyer.name, taxId: validBuyer.taxId, type: validBuyer.type };
      const dto = plainToInstance(IssueCorrectionRequestDto, {
        reason: 'wrong NIP',
        lines: [{ originalLineNumber: 1, newQuantity: 1 }],
        buyerOverride: noAddress,
      });

      const errors = await validate(dto);

      expect(errors.some((e) => e.property === 'buyerOverride')).toBe(true);
    });
  });
});

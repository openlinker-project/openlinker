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
});

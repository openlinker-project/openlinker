import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  benchInvoiceNotPrintable,
  benchPackerUnidentified,
  benchParcelNotFound,
} from './bench-errors';

describe('bench errors (#3865)', () => {
  it('should send one code for an unknown parcel and one outside this bench', () => {
    const error = benchParcelNotFound();

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getResponse()).toEqual({
      statusCode: 404,
      code: 'BENCH_PARCEL_NOT_FOUND',
      message: 'No such parcel at this bench',
    });
  });

  it('should tell the packer the box goes without the invoice', () => {
    const error = benchInvoiceNotPrintable('work-1');

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      code: 'BENCH_INVOICE_NOT_PRINTABLE',
      params: { workId: 'work-1' },
    });
  });

  it('should keep the 401 class for an unidentified packer', () => {
    const error = benchPackerUnidentified('A claim must name the packer');

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toEqual({
      statusCode: 401,
      code: 'BENCH_PACKER_UNIDENTIFIED',
      message: 'A claim must name the packer',
    });
  });
});

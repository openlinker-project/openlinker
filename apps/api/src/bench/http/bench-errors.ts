/**
 * Pack bench errors (#3865)
 *
 * The coded HTTP errors the pack bench sends. The packer reads the copy the
 * frontend picks by `code` (ADR-081), so each situation a packer can act on
 * differently has its own code; `message` stays the English sentence the
 * endpoint always sent. No buyer data and no carrier or provider text travels
 * in a body here.
 *
 * @module apps/api/src/bench/http
 */
import { HttpStatus, UnauthorizedException, type HttpException } from '@nestjs/common';
import { codedErrorBody, codedHttpError } from '../../common/errors/coded-http.exception';

/**
 * The work id is unknown, or the parcel is not one this bench may see. One
 * code for both on purpose: telling them apart would let a packer enumerate
 * which work ids exist.
 */
export function benchParcelNotFound(): HttpException {
  return codedHttpError(
    HttpStatus.NOT_FOUND,
    'BENCH_PARCEL_NOT_FOUND',
    'No such parcel at this bench'
  );
}

/** The parcel's invoice exists but cannot be printed; the box goes without it. */
export function benchInvoiceNotPrintable(workId: string): HttpException {
  return codedHttpError(
    HttpStatus.CONFLICT,
    'BENCH_INVOICE_NOT_PRINTABLE',
    'This invoice has no printable version. Send the box without it.',
    { workId }
  );
}

/**
 * The verified token names no user, so the bench cannot record who acted.
 * Kept as Nest's `UnauthorizedException`: the status has no entry in
 * `codedHttpError`'s class table.
 */
export function benchPackerUnidentified(message: string): HttpException {
  return new UnauthorizedException(
    codedErrorBody(HttpStatus.UNAUTHORIZED, 'BENCH_PACKER_UNIDENTIFIED', message)
  );
}

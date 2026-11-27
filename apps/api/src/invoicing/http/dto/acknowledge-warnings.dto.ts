/**
 * Acknowledged Warnings (request field)
 *
 * The codes an operator accepted after OpenLinker warned that a document rests
 * on a reading of the law it cannot be sure of. OpenLinker suggests; the
 * operator decides. A 422 with `failureCode: 'acknowledgement-required'`
 * carries the `warningCode` to send back here. Codes are opaque: each provider
 * adapter owns its own.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export function AcknowledgeWarningsProperty(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      type: [String],
      description:
        'Warning codes the operator accepted, from the `warningCode` of a previous 422 ' +
        "with failureCode 'acknowledgement-required'.",
    }),
    IsOptional(),
    IsArray(),
    ArrayMaxSize(20),
    IsString({ each: true }),
    MaxLength(64, { each: true }),
  );
}

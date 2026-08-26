/**
 * Fiscal Registration Response DTO (#1908)
 *
 * Read projection of a `FiscalRegistrationRecord`.
 *
 * An explicit ALLOWLIST, not a spread: `errorMessage` is deliberately absent
 * because it is the internal, third-party-shaped diagnostic that may echo
 * buyer-supplied data. The operator-facing explanation is `failureReason`, which
 * is PII-free by construction.
 *
 * @module apps/api/src/fiscalization/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
// `FiscalRegistrationStatus` is a VALUE import on purpose: it annotates a
// decorated property, and `emitDecoratorMetadata` needs the binding to survive
// erasure (same reason `invoice-record-response.dto.ts` does it).
import { FiscalRegistrationStatus } from '@openlinker/core/fiscalization';
import type {
  FiscalArtefact,
  FiscalRegistrationFailureMode,
} from '@openlinker/core/fiscalization';

export class FiscalArtefactDto {
  @ApiProperty({ description: 'Adapter-declared form of the artefact' })
  medium!: FiscalArtefact['medium'];

  @ApiProperty({ description: 'Adapter suggestion for what to do with it - a hint, not an order' })
  disposition!: FiscalArtefact['disposition'];

  @ApiProperty({ description: 'Opaque payload; base64 when medium is "document"' })
  content!: string;

  @ApiPropertyOptional({ description: 'MIME type when the adapter knows one', nullable: true })
  contentType!: string | null;

  @ApiPropertyOptional({ description: 'Short adapter-supplied label', nullable: true })
  label!: string | null;
}

export class FiscalRegistrationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty({ description: 'Provider identity; empty until an attempt completes' })
  providerType!: string;

  @ApiProperty({ description: 'The exactly-once key this registration is held under' })
  idempotencyKey!: string;

  @ApiProperty({ description: 'pending | registering | registered | failed' })
  status!: FiscalRegistrationStatus;

  @ApiPropertyOptional({ description: 'Provider-assigned locator key', nullable: true })
  providerReference!: string | null;

  @ApiPropertyOptional({
    description: 'Reference borne by the registered document',
    nullable: true,
  })
  documentReference!: string | null;

  @ApiPropertyOptional({
    description: 'Flat identifier of whatever performed or signed the registration',
    nullable: true,
  })
  signingIdentity!: string | null;

  @ApiPropertyOptional({ nullable: true })
  registeredAt!: string | null;

  @ApiPropertyOptional({
    description: 'Adapter-owned flat key/value pairs with no cross-regime counterpart',
    nullable: true,
  })
  regimeExtras!: Record<string, string> | null;

  @ApiPropertyOptional({
    description:
      'Customer-facing outputs. An empty list on a registered record is a SUCCESS - a pure ' +
      'reporting regime returns identifiers only.',
    type: [FiscalArtefactDto],
    nullable: true,
  })
  artefacts!: FiscalArtefactDto[] | null;

  @ApiPropertyOptional({
    description:
      'rejected = the provider definitely created nothing (safe to retry); in-doubt = the sale ' +
      'may already be registered and is NEVER auto-retried.',
    nullable: true,
  })
  failureMode!: FiscalRegistrationFailureMode | null;

  @ApiPropertyOptional({ description: 'PII-free operator-facing reason', nullable: true })
  failureReason!: string | null;

  @ApiProperty({
    description:
      'True while an attempt holds the in-flight claim on this record - a registration is being ' +
      'run right now and needs no action. READ-ONLY and derived: asking does not take the claim, ' +
      'call the provider or attempt anything. A claim that has EXPIRED reads false, because an ' +
      'expired lease means the previous attempt died rather than that one is running.',
  })
  inFlight!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

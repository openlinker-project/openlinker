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

/**
 * One customer-facing output a registration produced.
 *
 * This DTO is the PAYLOAD-BEARING one: it carries `content` because the panel's
 * open/download/scan affordances need the bytes. A per-order sales-document
 * projection reads `FiscalArtefactSummary` (`@openlinker/core/fiscalization`,
 * #2523) instead - the same three facts an affordance needs, with no payload -
 * and any new consumer deciding what to OFFER should read that rather than
 * widening this one.
 *
 * **Nothing here reports delivery, and no reading of it can.** `disposition` is
 * what the adapter SUGGESTS a caller might do; no shipped adapter reports
 * whether a document reached a buyer, so `send` must never be rendered as "sent
 * to the customer". There is deliberately no timestamp, recipient, status or
 * attempt count here to derive such a claim from.
 */
export class FiscalArtefactDto {
  @ApiProperty({ description: 'Adapter-declared form of the artefact' })
  medium!: FiscalArtefact['medium'];

  @ApiProperty({
    description:
      'What the adapter SUGGESTS is done with this artefact - print, display, send or retain. A ' +
      'hint about a possible action, NEVER a record that it happened: no shipped adapter reports ' +
      'whether a document reached a buyer, so "send" does not mean it was sent.',
  })
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
      'Customer-facing outputs, with their payloads. An empty list on a registered record is a ' +
      'SUCCESS - a pure reporting regime returns identifiers only - and is distinct from null, ' +
      'which means the registration never got far enough to produce anything. Says nothing about ' +
      'delivery to the buyer, which no shipped adapter reports.',
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
      'expired lease means the previous attempt died rather than that one is running. ' +
      'INTERIM: this reports fiscal receipts only, and an invoice has no counterpart field here ' +
      'on purpose. Both kinds report through one neutral shape on the per-order sales-document ' +
      'projection, which supersedes this field - build a surface covering both kinds on that, ' +
      'not on this.',
  })
  inFlight!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

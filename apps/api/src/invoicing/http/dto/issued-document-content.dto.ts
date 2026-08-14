/**
 * Issued Document Content DTO
 *
 * Neutral (#1224, ADR-026) issued-document content view returned by
 * `GET /invoices/:invoiceId/content`, backing the FE "Invoice contents" card.
 * Mirrors the core `IssuedDocumentContent` snapshot (§7.3) verbatim — scheme-tagged
 * tax ids, neutral `taxRate` string codes, ISO-4217 `currency`, ISO-8601 dates. No
 * regime/provider vocabulary crosses here.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type {
  IssuedDocumentContent,
  IssuedDocumentLine,
  IssuedDocumentPayment,
  IssuedDocumentSeller,
  TaxBreakdownEntry,
} from '@openlinker/core/invoicing';
import {
  BuyerAddress,
  DocumentTotals,
  IssuedDocumentBuyer,
  TaxIdentifier,
} from '@openlinker/core/invoicing';

class TaxIdentifierDto implements TaxIdentifier {
  @ApiProperty({ description: 'Open scheme tag the provider interprets (e.g. `pl-nip`).' })
  scheme!: string;

  @ApiProperty({ description: 'Tax identifier value.' })
  value!: string;
}

class BuyerAddressDto implements BuyerAddress {
  @ApiProperty() line1!: string;
  @ApiProperty({ nullable: true }) line2!: string | null;
  @ApiProperty() city!: string;
  @ApiProperty() postalCode!: string;
  @ApiProperty({ description: 'ISO 3166-1 alpha-2 country code.' }) countryIso2!: string;
}

class SellerDto implements IssuedDocumentSeller {
  @ApiProperty() name!: string;
  @ApiProperty({ type: TaxIdentifierDto }) taxId!: TaxIdentifier;
  @ApiProperty({ type: BuyerAddressDto }) address!: BuyerAddress;
}

class BuyerDto implements IssuedDocumentBuyer {
  @ApiProperty() name!: string;
  @ApiProperty({ type: TaxIdentifierDto, nullable: true }) taxId!: TaxIdentifier | null;
  @ApiProperty({ type: BuyerAddressDto }) address!: BuyerAddress;
}

class LineDto implements IssuedDocumentLine {
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitNet!: number;
  @ApiProperty({ description: 'Neutral tax-rate string code (e.g. `23`, `zw`).' }) taxRate!: string;
  @ApiProperty() net!: number;
  @ApiProperty() tax!: number;
  @ApiProperty() gross!: number;
}

class TaxBreakdownDto implements TaxBreakdownEntry {
  @ApiProperty() rate!: string;
  @ApiProperty() net!: number;
  @ApiProperty() tax!: number;
  @ApiProperty() gross!: number;
}

class TotalsDto implements DocumentTotals {
  @ApiProperty() net!: number;
  @ApiProperty() tax!: number;
  @ApiProperty() gross!: number;
}

class PaymentDto implements IssuedDocumentPayment {
  @ApiProperty({ nullable: true }) method!: string | null;
  @ApiProperty({ nullable: true }) paidAt!: string | null;
}

export class IssuedDocumentContentDto {
  @ApiProperty({
    type: SellerDto,
    nullable: true,
    description: 'Seller party; null when the issuing adapter surfaces no seller block.',
  })
  seller!: IssuedDocumentSeller | null;

  @ApiProperty({ type: BuyerDto })
  buyer!: IssuedDocumentBuyer;

  @ApiProperty({ type: [LineDto] })
  lines!: IssuedDocumentLine[];

  @ApiProperty({ type: [TaxBreakdownDto] })
  taxBreakdown!: TaxBreakdownEntry[];

  @ApiProperty({ type: TotalsDto })
  totals!: DocumentTotals;

  @ApiProperty({ description: 'ISO 4217 currency code.' })
  currency!: string;

  @ApiProperty({ nullable: true, description: 'ISO 8601 issue date; null when unknown.' })
  issueDate!: string | null;

  @ApiProperty({ nullable: true, description: 'ISO 8601 sale date; null when not provided.' })
  saleDate!: string | null;

  /**
   * Whether these `lines` are the array a CORRECTION will index (#2076).
   *
   * `documentContent` and `issuedLineSnapshot` are separate columns added by
   * separate migrations (`1818000000001` then `1818000000003`), so an invoice
   * issued between those deploys carries content but NO snapshot. For such a
   * row `POST /invoices/:id/correct` cannot use the snapshot and rebuilds the
   * original document from the ORDER'S CURRENT STATE instead — a different
   * array, with the line-fidelity caveats documented on
   * `OriginalDocumentSnapshot`.
   *
   * A correction UI that lets an operator pick a line MUST NOT present these
   * lines as authoritative when this is false: the position they choose would
   * index an array the server never sees. `true` means content and snapshot
   * were written from the same array in the same `InvoiceService` call, so a
   * picked 1-based position is exactly `originalLineNumber`.
   */
  @ApiProperty({
    description:
      'True when a correction will index exactly these lines (the issuance-time ' +
      'line snapshot exists). False for invoices issued before that column, where ' +
      'a correction rebuilds from the order\'s current state instead.',
  })
  linesIndexedByCorrection!: boolean;

  @ApiProperty({ type: PaymentDto, nullable: true })
  payment!: IssuedDocumentPayment | null;

  static fromDomain(
    content: IssuedDocumentContent,
    linesIndexedByCorrection: boolean,
  ): IssuedDocumentContentDto {
    const dto = new IssuedDocumentContentDto();
    dto.linesIndexedByCorrection = linesIndexedByCorrection;
    dto.seller = content.seller;
    dto.buyer = content.buyer;
    dto.lines = content.lines;
    dto.taxBreakdown = content.taxBreakdown;
    dto.totals = content.totals;
    dto.currency = content.currency;
    dto.issueDate = content.issueDate;
    dto.saleDate = content.saleDate;
    dto.payment = content.payment;
    return dto;
  }
}

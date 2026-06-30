/**
 * Types for KSeF FA(3) XML view (#1228).
 *
 * @module plugins/ksef/components
 */

export interface FaLine {
  lineNo: string | null;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  netUnitPrice: string | null;
  netTotal: string | null;
  vatRate: string | null;
}

export interface FaData {
  sellerName: string | null;
  sellerNip: string | null;
  buyerName: string | null;
  buyerNip: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  lines: FaLine[];
  vatNet23: string | null;
  vatTax23: string | null;
  vatNet8: string | null;
  vatTax8: string | null;
  vatNet0: string | null;
  vatTax0: string | null;
  grandTotal: string | null;
  ksefNumber: string | null;
}

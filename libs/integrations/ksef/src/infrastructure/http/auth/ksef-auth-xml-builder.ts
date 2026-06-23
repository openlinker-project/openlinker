/**
 * KSeF Auth Token Request XML Builder
 *
 * Builds the AuthTokenRequest XML envelope for the KSeF auth handshake. The
 * ksef-token flow folds a simple challenge + context NIP + timestamp into the
 * envelope (no signature); the qualified-seal flow appends an XAdES signature.
 *
 * DEFERRED (C4): the qualified-seal / XAdES-DSig path. Hand-rolling XAdES
 * (SignatureMethod URIs, InclusiveNamespaces, canonicalization, cert chain
 * ordering) has zero margin for error in a tax-authority context, so `signXades`
 * is a documented stub that throws in production. C4 will evaluate a vetted XML
 * signing library + real X.509/HSM material. Unit coverage of the *unsigned*
 * builder is in scope for C3; the signed path is exercised only via the fake
 * auth service.
 *
 * No external XML dependency: the unsigned envelope is small and fixed-shape, so
 * we build it by string composition with strict escaping of interpolated values.
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import { KsefConfigException } from '../../../domain/exceptions/ksef-config.exception';

/** Escape the five XML predefined entities so an interpolated value can't break the envelope. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface AuthTokenRequestFields {
  challenge: string;
  contextNip: string;
  timestamp: string;
}

export class KsefAuthXmlBuilder {
  /**
   * Build the unsigned AuthTokenRequest XML envelope. Shared by both flows — the
   * qualified-seal flow signs the result via `signXades`.
   */
  buildAuthTokenRequest(fields: AuthTokenRequestFields): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<AuthTokenRequest>',
      `<Challenge>${escapeXml(fields.challenge)}</Challenge>`,
      `<ContextNip>${escapeXml(fields.contextNip)}</ContextNip>`,
      `<Timestamp>${escapeXml(fields.timestamp)}</Timestamp>`,
      '</AuthTokenRequest>',
    ].join('');
  }

  /**
   * Sign an AuthTokenRequest envelope with a qualified seal (XAdES).
   *
   * DEFERRED to C4: requires real X.509 material (HSM/PKCS#11) and a vetted XML
   * signing library. Throws in production so a qualified-seal connection fails
   * loudly until the real path lands; the fake auth service short-circuits this
   * for unit coverage.
   */
  signXades(_unsignedXml: string): string {
    throw new KsefConfigException(
      'Qualified-seal (XAdES) signing is not implemented until C4; use a ksef-token connection',
    );
  }
}

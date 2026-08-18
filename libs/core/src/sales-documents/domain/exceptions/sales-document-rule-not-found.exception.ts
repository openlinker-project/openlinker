/**
 * Sales-Document Rule / Country-Default Not Found Exceptions (#2170)
 *
 * @module libs/core/src/sales-documents/domain/exceptions
 */
export class SalesDocumentRuleNotFoundException extends Error {
  constructor(public readonly ruleId: string) {
    super(`Sales-document rule '${ruleId}' not found.`);
    this.name = 'SalesDocumentRuleNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SalesDocumentCountryDefaultNotFoundException extends Error {
  constructor(public readonly defaultId: string) {
    super(`Sales-document country default '${defaultId}' not found.`);
    this.name = 'SalesDocumentCountryDefaultNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}

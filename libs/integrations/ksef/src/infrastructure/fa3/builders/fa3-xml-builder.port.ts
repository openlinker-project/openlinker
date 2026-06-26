/**
 * FA(3) XML Builder Port
 *
 * Abstraction over "produce a structurally-validated FA(3) document from mapped
 * input". The invoicing adapter depends on this interface, not the concrete
 * `Fa3WithValidationBuilder`, so a future variant (corrective credit-note, a new
 * schema revision) can be swapped without touching the adapter. Package-private:
 * not re-exported from the package barrel.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/builders
 */
import type { Fa3BuilderInput, RawFa3Xml } from '../domain/fa3-xml.types';

export interface IFa3XmlBuilder {
  /**
   * Build + structurally validate an FA(3) document from fully-mapped input.
   *
   * @throws {Fa3XsdValidationException} if the built document fails structural validation.
   */
  build(input: Fa3BuilderInput): RawFa3Xml;
}

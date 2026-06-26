/**
 * FA(3) Build + Validate Pipeline
 *
 * Composes the pure builder with the structural validator behind the
 * `IFa3XmlBuilder` port: build → validate → return. This is the only FA(3)
 * surface the adapter touches — the pure builder and validator stay
 * package-private composition details, so a future schema/document variant can
 * be swapped without changing the adapter. Synchronous (the pure builder is),
 * no I/O, no credentials.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/builders
 */
import type { Fa3BuilderInput, RawFa3Xml } from '../domain/fa3-xml.types';
import { validateFa3Xml } from '../validators/fa3-xsd.validator';
import { buildFa3Xml } from './fa3-xml.builder';
import type { IFa3XmlBuilder } from './fa3-xml-builder.port';

export class Fa3WithValidationBuilder implements IFa3XmlBuilder {
  build(input: Fa3BuilderInput): RawFa3Xml {
    const xml = buildFa3Xml(input);
    validateFa3Xml(xml);
    return xml;
  }
}

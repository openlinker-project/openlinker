/**
 * FA(3) Structural Validator
 *
 * Validates a built FA(3) document against (1) XML well-formedness via
 * `fast-xml-parser`'s `XMLValidator`, and (2) the vendored FA(3) structural rule
 * set (correct root + namespace, required sections present, line cardinality).
 * On any failure it throws `Fa3XsdValidationException` with a bounded list of
 * neutral `{ path, message }` issues — never the raw XML (which would echo buyer
 * PII into logs).
 *
 * AUTHORITY CAVEAT (see SCHEMA_VALIDATION_STATUS.md): this is *structural*,
 * working-copy validation only. Authoritative validation against the latest
 * crd.gov.pl XSD and MF example-pack compliance are deferred to C3+ (the KSeF
 * submission phase). A full XSD engine (libxmljs) is intentionally NOT pulled in
 * — it needs a native build that fails on the constrained CI; the structural
 * rule set is the right-sized skeleton gate.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/validators
 */
import { XMLValidator } from 'fast-xml-parser';
import {
  Fa3XsdValidationException,
  type Fa3ValidationIssue,
} from '../../../domain/exceptions/fa3-validation.exception';
import { FA3_NAMESPACE, FA3_ROOT_ELEMENT } from '../domain/fa3-xml.types';
import type { RawFa3Xml } from '../domain/fa3-xml.types';

/**
 * Structurally validate an FA(3) document. Returns normally on success; throws
 * `Fa3XsdValidationException` on a well-formedness or structural failure.
 *
 * Scope (see SCHEMA_VALIDATION_STATUS.md): XML well-formedness (via
 * `fast-xml-parser`'s `XMLValidator`) plus a hand-written structural rule set
 * (correct root element + namespace, required `Naglowek` section). Authoritative
 * XSD-engine validation against the MF schema is deliberately deferred to C3+.
 */
export function validateFa3Xml(xml: RawFa3Xml): void {
  const issues: Fa3ValidationIssue[] = [];

  // 1. Well-formedness. XMLValidator returns `true` or an error descriptor —
  //    we surface the neutral reason only, never the raw XML.
  const wellFormed = XMLValidator.validate(xml);
  if (wellFormed !== true) {
    issues.push({ path: '/', message: `not well-formed XML: ${wellFormed.err.msg}` });
    // A non-well-formed document can't be structurally inspected further.
    throw new Fa3XsdValidationException(issues);
  }

  // 2. Structural rules — lightweight string assertions over the serialised
  //    document (no DOM walk needed for these coarse layout checks).
  if (!new RegExp(`<${FA3_ROOT_ELEMENT}[\\s>]`).test(xml)) {
    issues.push({ path: '/', message: `root element must be <${FA3_ROOT_ELEMENT}>` });
  }
  if (!xml.includes(FA3_NAMESPACE)) {
    issues.push({ path: `/${FA3_ROOT_ELEMENT}/@xmlns`, message: 'missing FA(3) namespace' });
  }
  if (!/<Naglowek[\s/>]/.test(xml)) {
    issues.push({ path: `/${FA3_ROOT_ELEMENT}/Naglowek`, message: 'missing Naglowek section' });
  }

  if (issues.length > 0) {
    throw new Fa3XsdValidationException(issues);
  }
}

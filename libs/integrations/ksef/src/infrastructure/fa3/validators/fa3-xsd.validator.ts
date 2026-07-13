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
 * AUTHORITY CAVEAT (see SCHEMA_VALIDATION_STATUS.md): the vendored XSD is now the
 * authoritative Ministry-of-Finance FA(3) v1-0E schema, and the structural rule
 * set below is derived from it. Validation remains *structural* — a full XSD
 * engine (libxmljs) is intentionally NOT pulled in, since it needs a native build
 * that fails on the constrained CI. Conformance is asserted by the rule set plus
 * the builder emitting XSD-valid structure; MF example-pack compliance and live
 * KSeF clearance stay deferred to the submission phase (C3+).
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/validators
 */
import { XMLValidator } from 'fast-xml-parser';
import {
  Fa3XsdValidationException,
  type Fa3ValidationIssue,
} from '../../../domain/exceptions/fa3-validation.exception';
import {
  FA3_FA_WIERSZ_CHILD_ORDER,
  FA3_NAMESPACE,
  FA3_PLATNOSC_CHILD_ORDER,
  FA3_RACHUNEK_BANKOWY_CHILD_ORDER,
  FA3_ROOT_ELEMENT,
  FA3_SCHEMA_VERSION,
} from '../domain/fa3-xml.types';
import type { RawFa3Xml } from '../domain/fa3-xml.types';
import {
  Fa3KodWalutyValues,
  Fa3P12Values,
  type Fa3KodWaluty,
  type Fa3P12Value,
} from '../domain/fa3-schema.types';

/**
 * Structurally validate an FA(3) document. Returns normally on success; throws
 * `Fa3XsdValidationException` on a well-formedness or structural failure.
 *
 * Scope (see SCHEMA_VALIDATION_STATUS.md): XML well-formedness (via
 * `fast-xml-parser`'s `XMLValidator`) plus a hand-written structural rule set
 * derived from the FA(3) v1-0E XSD — root + namespace, `Naglowek` (with the
 * KodFormularza identity attributes) + `WariantFormularza`, `Podmiot1` and
 * `Podmiot2` identification, the `Fa` body's required children (`KodWaluty`, `P_1`,
 * `P_2`, `RodzajFaktury`, `Adnotacje`, and ≥1 `FaWiersz`), and — when `Platnosc`
 * is present — the XSD-mandated child ordering of the `Platnosc` block and each
 * `RachunekBankowy` inside it (#1311, PR #1317 review). Full XSD-engine
 * validation is deliberately deferred to C3+.
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
  //    document, derived from the real FA(3) v1-0E XSD's required sections (no
  //    DOM walk needed for these coarse layout checks).
  if (!new RegExp(`<${FA3_ROOT_ELEMENT}[\\s>]`).test(xml)) {
    issues.push({ path: '/', message: `root element must be <${FA3_ROOT_ELEMENT}>` });
  }
  if (!xml.includes(FA3_NAMESPACE)) {
    issues.push({ path: `/${FA3_ROOT_ELEMENT}/@xmlns`, message: 'missing FA(3) namespace' });
  }

  const root = `/${FA3_ROOT_ELEMENT}`;
  // Naglowek + its KodFormularza identity attributes (TNaglowek).
  if (!/<Naglowek[\s/>]/.test(xml)) {
    issues.push({ path: `${root}/Naglowek`, message: 'missing Naglowek section' });
  }
  if (!/<KodFormularza[\s>][^]*?kodSystemowy="FA \(3\)"/.test(xml)) {
    issues.push({
      path: `${root}/Naglowek/KodFormularza/@kodSystemowy`,
      message: 'KodFormularza must carry kodSystemowy="FA (3)"',
    });
  }
  if (new RegExp(`<KodFormularza[\\s>][^]*?wersjaSchemy="${FA3_SCHEMA_VERSION}"`).test(xml) === false) {
    issues.push({
      path: `${root}/Naglowek/KodFormularza/@wersjaSchemy`,
      message: `KodFormularza must carry wersjaSchemy="${FA3_SCHEMA_VERSION}"`,
    });
  }
  if (!/<WariantFormularza[\s/>]/.test(xml)) {
    issues.push({ path: `${root}/Naglowek/WariantFormularza`, message: 'missing WariantFormularza' });
  }
  // Podmiot1 (seller) identification.
  if (!/<Podmiot1[\s/>][^]*?<DaneIdentyfikacyjne[\s/>]/.test(xml)) {
    issues.push({
      path: `${root}/Podmiot1/DaneIdentyfikacyjne`,
      message: 'missing Podmiot1/DaneIdentyfikacyjne section',
    });
  }
  // Podmiot2 (buyer) identification — mandatory in the XSD, same as Podmiot1.
  if (!/<Podmiot2[\s/>][^]*?<DaneIdentyfikacyjne[\s/>]/.test(xml)) {
    issues.push({
      path: `${root}/Podmiot2/DaneIdentyfikacyjne`,
      message: 'missing Podmiot2/DaneIdentyfikacyjne section',
    });
  }
  // Fa body + its required children.
  if (!/<Fa[\s>]/.test(xml)) {
    issues.push({ path: `${root}/Fa`, message: 'missing Fa section' });
  } else {
    for (const child of ['KodWaluty', 'P_1', 'P_2', 'RodzajFaktury', 'Adnotacje'] as const) {
      if (!new RegExp(`<${child}[\\s/>]`).test(xml)) {
        issues.push({ path: `${root}/Fa/${child}`, message: `missing Fa/${child}` });
      }
    }
    if (!/<FaWiersz[\s/>]/.test(xml)) {
      issues.push({ path: `${root}/Fa/FaWiersz`, message: 'Fa must contain at least one FaWiersz line' });
    }
    // `FaWiersz` child ordering (#1525): the XSD mandates a fixed sequence
    // (notably P_8A immediately before P_8B and P_9A immediately after) - a
    // wrong-order row is rejected by KSeF at clearance, and the presence-only
    // checks above would not catch a builder ordering regression.
    for (const row of xml.matchAll(/<FaWiersz>([^]*?)<\/FaWiersz>/g)) {
      pushChildOrderIssues(row[1], FA3_FA_WIERSZ_CHILD_ORDER, `${root}/Fa/FaWiersz`, issues);
    }
  }

  // 2b. `Fa/Platnosc` child ordering (#1311, PR #1317 review). The XSD mandates
  //     a fixed sequence for `Platnosc` children and for `RachunekBankowy`
  //     children (`SWIFT` before `NazwaBanku`); a wrong-order document is
  //     rejected by KSeF at clearance. The generic Fa-children checks above are
  //     presence-only, so without this block an ordering regression in the
  //     builder would sail through the "passes the structural validator" tests.
  const platnoscMatch = xml.match(/<Platnosc>([^]*?)<\/Platnosc>/);
  if (platnoscMatch !== null) {
    const platnoscPath = `${root}/Fa/Platnosc`;
    pushChildOrderIssues(platnoscMatch[1], FA3_PLATNOSC_CHILD_ORDER, platnoscPath, issues);
    for (const rb of platnoscMatch[1].matchAll(/<RachunekBankowy>([^]*?)<\/RachunekBankowy>/g)) {
      const rbPath = `${platnoscPath}/RachunekBankowy`;
      if (!/<NrRB[\s/>]/.test(rb[1])) {
        issues.push({ path: `${rbPath}/NrRB`, message: 'RachunekBankowy must contain NrRB' });
      }
      pushChildOrderIssues(rb[1], FA3_RACHUNEK_BANKOWY_CHILD_ORDER, rbPath, issues);
    }
  }

  // 3. Token allow-list guards. The XSD restricts `P_12` to the TStawkaPodatku
  //    enum and `KodWaluty` to the currency set; a value outside the supported
  //    token sets (e.g. a stale bare `np`, or an unmapped currency) would be
  //    rejected by KSeF at clearance. Catch it here, cheaply, at build time —
  //    every occurrence is checked so a single bad line surfaces.
  const p12Allowed = new Set<string>(Fa3P12Values as ReadonlyArray<Fa3P12Value>);
  for (const match of xml.matchAll(/<P_12>([^<]*)<\/P_12>/g)) {
    const value = match[1];
    if (!p12Allowed.has(value)) {
      issues.push({
        path: `${root}/Fa/FaWiersz/P_12`,
        message: `P_12 "${value}" is not a valid TStawkaPodatku token`,
      });
    }
  }
  const currencyAllowed = new Set<string>(Fa3KodWalutyValues as ReadonlyArray<Fa3KodWaluty>);
  for (const match of xml.matchAll(/<KodWaluty>([^<]*)<\/KodWaluty>/g)) {
    const value = match[1];
    if (!currencyAllowed.has(value)) {
      issues.push({
        path: `${root}/Fa/KodWaluty`,
        message: `KodWaluty "${value}" is not a supported currency code`,
      });
    }
  }

  if (issues.length > 0) {
    throw new Fa3XsdValidationException(issues);
  }
}

/**
 * Assert that the children present in `block` appear in the XSD-mandated
 * `canonical` sequence, by comparing first-occurrence offsets. Absent children
 * are skipped (all are optional at this level); a canonical-later element
 * found at an earlier offset than a canonical-earlier one is flagged. This is
 * a flat scan — it assumes `canonical` names do not also occur nested inside
 * each other within `block` (true for the element sets we pass in; see the
 * `FA3_PLATNOSC_CHILD_ORDER` caveat about the never-emitted `ZaplataCzesciowa`
 * group).
 */
function pushChildOrderIssues(
  block: string,
  canonical: readonly string[],
  basePath: string,
  issues: Fa3ValidationIssue[],
): void {
  let lastOffset = -1;
  let lastName: string | null = null;
  for (const name of canonical) {
    const offset = block.search(new RegExp(`<${name}[\\s/>]`));
    if (offset === -1) {
      continue;
    }
    if (offset < lastOffset && lastName !== null) {
      issues.push({
        path: `${basePath}/${name}`,
        message: `${name} must appear after ${lastName} per the XSD sequence`,
      });
    } else {
      lastOffset = offset;
      lastName = name;
    }
  }
}

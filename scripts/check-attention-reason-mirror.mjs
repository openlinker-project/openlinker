#!/usr/bin/env node
/**
 * check-attention-reason-mirror.mjs
 *
 * Lint-time invariant for the frontend mirror of the attention-reason
 * vocabulary (#2357, Wave-2 product spec § 4.2 / § 4.3).
 *
 * The authoritative declarations live in
 *   libs/core/src/fulfillment-authority/domain/types/authority-attention-reason.types.ts
 * whose docblock already promises the arrays are read TEXTUALLY ("one member
 * per line, no computed keys and no spread"). This script is that promise's
 * enforcement.
 *
 * The browser bundle cannot depend on `@openlinker/core` (#591), so the
 * frontend carries a copy — and a copy drifts silently in BOTH directions: a
 * reason added only to core never reaches the browser, and one added only to
 * the frontend type-checks against a value the API will never send.
 *
 * SIX MIRRORS:
 *
 *   M1  `AuthorityAttentionReasonValues`  core <-> apps/web (membership + order)
 *   M2  `AuthorityAttentionBadgeValues`   core <-> apps/web (membership + order)
 *   M3  per reason, `badge` AND `counted` in core's
 *       `AUTHORITY_ATTENTION_REASON_DESCRIPTORS` vs the frontend's
 *       `ATTENTION_REASON_MIRROR`
 *   M4  `ATTENTION_REASON_COPY` carries exactly one entry per reason, in order
 *   M5  `ATTENTION_BADGE_COPY` carries exactly one entry per badge value
 *   M6  cross-feature title agreement: the OR-P title equals
 *       `RETURN_ORPHAN_BANNER_COPY.title` in features/returns (spec § 4.2 —
 *       "the mirror check ... covers BOTH feature folders")
 *
 * WHY M3 MIRRORS TWO FIELDS AND NOT ONLY THE UNION. A mirror over the reason
 * union alone would let the aggregate count and the badge renderer disagree
 * under a green gate — precisely the failure § 4.3's single declared data table
 * ("one table, two readers") exists to prevent.
 *
 * ORDER. M1/M2 are `as const` arrays whose order IS the render order, so it is
 * checked. M4/M5 key object literals consumed by lookup; their order is checked
 * too, deliberately and for one reason only — the declarations are read
 * side-by-side when adding a member, which is the same rationale
 * `check-authority-kind-mirror` gives for its descriptor map. (Contrast
 * `check-ui-vocabulary`'s RULE A, which is order-INDEPENDENT because its
 * counterpart is a prose table where alphabetising is editorial.)
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE DOES **NOT** CATCH. Read this before trusting it.
 *
 *   1. It compares declarations, not renderers. A reason present in every array
 *      with copy nobody renders passes here. #2356's own component tests are
 *      what assert a row shows the title.
 *   2. M6 USED to carry a "pending" mode, and that mode is gone (#2673). A pair
 *      keyed on a declaration NAME degrades to a no-op the moment that
 *      declaration is renamed or moved, and while the mode existed "not found"
 *      and "not written yet" were indistinguishable to this script — so the
 *      RB-L pair sat green for a whole wave, pointing at a constant name and a
 *      file that never existed, while the two strings it was meant to hold
 *      identical drifted by a trailing period. Every pair is now LIVE: a pair
 *      whose file, declaration, field, or own-side copy entry cannot be read is
 *      a FAILURE naming the pair, never a note. A title that is not written yet
 *      therefore has no entry here at all — an absent pair is honest, a pair
 *      that compares nothing is a claim. The DECISION lives in the pure
 *      `classifyCrossFeatureTitle`, so `--self-check` can prove each of its
 *      arms; an arm reachable only through the filesystem is an arm no fixture
 *      can pin, which is how the old one stayed wrong.
 *   3. It says nothing about whether a sentence is good. `check-ui-vocabulary`
 *      proves nine words are absent; neither script reads copy for sense.
 *
 * ---------------------------------------------------------------------------
 * "MATCHED NOTHING" is a FAILURE, never a pass (#2384). Every declaration that
 * parses to zero entries is FATAL — a parser that silently stops matching would
 * otherwise approve everything forever. Note M3's `counted` arm is unfalsifiable
 * against the live repo today (all eight members are `counted: true`), so the
 * `--self-check` fixtures below are the ONLY thing proving that half works.
 *
 * Every file is parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * stays a zero-dependency `check:invariants` step like its siblings.
 *
 * Usage:
 *   node scripts/check-attention-reason-mirror.mjs
 *   node scripts/check-attention-reason-mirror.mjs --self-check
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const CORE_FILE = join(
  'libs',
  'core',
  'src',
  'fulfillment-authority',
  'domain',
  'types',
  'authority-attention-reason.types.ts',
);
const FE_MIRROR_FILE = join(
  'apps', 'web', 'src', 'features', 'fulfillment-authority', 'lib', 'attention-reason.ts',
);
const FE_COPY_FILE = join(
  'apps', 'web', 'src', 'features', 'fulfillment-authority', 'lib', 'attention-reason.copy.ts',
);

const REASON_DECLARATION = 'AuthorityAttentionReasonValues';
const BADGE_DECLARATION = 'AuthorityAttentionBadgeValues';
const CORE_DESCRIPTORS = 'AUTHORITY_ATTENTION_REASON_DESCRIPTORS';
const FE_DESCRIPTORS = 'ATTENTION_REASON_MIRROR';
const FE_REASON_COPY = 'ATTENTION_REASON_COPY';
const FE_BADGE_COPY = 'ATTENTION_BADGE_COPY';

/**
 * Titles this feature declares that another feature is the canonical owner of
 * (spec § 4.2). EVERY pair is live and compared — there is no pending mode, for
 * the reason recorded in note 2 above.
 */
const CROSS_FEATURE_TITLES = [
  {
    reason: 'return-unmatched',
    file: join('apps', 'web', 'src', 'features', 'returns', 'lib', 'return-detail.copy.ts'),
    declaration: 'RETURN_ORPHAN_BANNER_COPY',
    field: 'title',
  },
  {
    // Returns spec § 5.4 owns this string, and #2381 moved it out of
    // `returns-list.copy.ts` into its own module on #2357's behalf. The pair
    // used to name the old file AND an old constant spelling, so it resolved to
    // nothing and passed vacuously (#2673).
    reason: 'restock-blocked',
    file: join('apps', 'web', 'src', 'features', 'returns', 'lib', 'restock-blocked.copy.ts'),
    declaration: 'RETURN_RESTOCK_BLOCKED_COPY',
    field: 'title',
  },
];

const DOCS_REF = 'docs/specs/product-spec-oms-wave2-operator-experience.md § 4.2 / § 4.3';

/** Strip line and block comments so an annotated entry can't be read as a value. */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line the declaration starts on. `null` when absent.
 */
export function parseValues(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = content.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = stripComments(content.slice(openBracket + 1, closeBracket));
  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) values.push(m[1] ?? m[2]);

  return { line: content.slice(0, declMatch.index).split('\n').length, values };
}

/**
 * Mask everything that is not a depth-1 character of an object literal, so a
 * key regex cannot misread a nested `badge:` line or a string fragment as a
 * top-level key. Adapted from `check-authority-kind-mirror.mjs`.
 *
 * Returns `{ masked, endIndex }`, or `null` when the literal is unbalanced.
 */
export function maskObjectBody(content, openBrace) {
  const chars = content.split('');
  const masked = new Array(chars.length).fill(' ');
  let depth = 0;

  const endOfString = (start) => {
    const quote = chars[start];
    for (let j = start + 1; j < chars.length; j += 1) {
      if (chars[j] === '\\') { j += 1; continue; }
      if (chars[j] === quote) return j + 1;
    }
    return chars.length;
  };

  for (let i = openBrace; i < chars.length; i += 1) {
    const ch = chars[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfString(i);
      let k = end;
      while (k < chars.length && /\s/.test(chars[k])) k += 1;
      if (depth === 1 && chars[k] === ':') {
        for (let j = i; j < end; j += 1) masked[j] = chars[j];
      }
      i = end - 1;
      continue;
    }

    if (ch === '{') { depth += 1; if (depth === 1) masked[i] = ch; continue; }
    if (ch === '}') { depth -= 1; if (depth === 0) return { masked: masked.join(''), endIndex: i }; continue; }
    if (depth === 1) masked[i] = ch;
  }

  return null;
}

/** Read a quoted string field out of one entry's raw source segment. */
function stringField(segment, fieldName) {
  const m = new RegExp(`${fieldName}\\s*:\\s*'([^']*)'|${fieldName}\\s*:\\s*"([^"]*)"`).exec(segment);
  return m ? (m[1] ?? m[2]) : null;
}

/**
 * Read a boolean field. A DEDICATED reader, not `stringField`: `counted: false`
 * read as `null` on both sides would compare equal and silently make M3's
 * counted arm inert — which no live-repo run could ever reveal, because every
 * member is `counted: true` today.
 */
function booleanField(segment, fieldName) {
  const m = new RegExp(`${fieldName}\\s*:\\s*(true|false)\\b`).exec(segment);
  return m ? m[1] === 'true' : null;
}

/**
 * THE traversal. One walk, shared by every reader below.
 *
 * Returns each depth-1 entry as `{ key, segment }`, where `segment` is that
 * entry's own raw source. Three readers used to redo this walk by hand; a file
 * whose purpose is preventing two copies of one rule should not carry three
 * copies of one traversal, and a hand-copy that forgot to scope its field read
 * to the segment is exactly how M6 would go quietly green on a real drift.
 *
 * Returns `null` when the declaration is absent or its literal is unbalanced.
 */
export function parseEntrySegments(content, name) {
  const declRe = new RegExp(`${name}\\s*(?::[^=]*)?=\\s*`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const stripped = stripComments(content);
  const strippedDecl = declRe.exec(stripped);
  if (!strippedDecl) return null;
  const openBrace = stripped.indexOf('{', strippedDecl.index + strippedDecl[0].length - 1);
  if (openBrace === -1) return null;

  const maskedResult = maskObjectBody(stripped, openBrace);
  if (!maskedResult) return null;

  const body = maskedResult.masked.slice(openBrace + 1, maskedResult.endIndex);
  const rawBody = stripped.slice(openBrace + 1, maskedResult.endIndex);

  // Every reason key is hyphenated and quoted, so hyphens are load-bearing.
  const keyRe = /(?:^|[\s,])(?:'([a-z-]+)'|"([a-z-]+)"|([a-z-]+))\s*:/gm;
  const keys = [];
  const starts = [];
  let m;
  while ((m = keyRe.exec(body)) !== null) {
    keys.push(m[1] ?? m[2] ?? m[3]);
    starts.push(m.index);
  }

  const entries = keys.map((key, i) => ({
    key,
    segment: rawBody.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : rawBody.length),
  }));

  return { line: content.slice(0, declMatch.index).split('\n').length, entries };
}

/**
 * Ordered depth-1 entries with their `badge` + `counted`, for M3.
 * Fields are `null` when absent.
 */
export function parseDescriptorEntries(content, name) {
  const parsed = parseEntrySegments(content, name);
  if (parsed === null) return null;
  return {
    line: parsed.line,
    entries: parsed.entries.map(({ key, segment }) => ({
      key,
      badge: stringField(segment, 'badge'),
      counted: booleanField(segment, 'counted'),
    })),
  };
}

/** Depth-1 keys of an object literal, in order. `null` when absent/unbalanced. */
export function parseObjectKeys(content, name) {
  const parsed = parseEntrySegments(content, name);
  return parsed === null ? null : { line: parsed.line, values: parsed.entries.map((e) => e.key) };
}

/**
 * One entry's own string field, read from THAT ENTRY'S segment.
 *
 * Segment-scoped deliberately: reading the field off the whole object body
 * returns the first match in the declaration, which is correct only while every
 * such declaration happens to be flat. Serves both M6 halves — this feature's
 * `ATTENTION_REASON_COPY[reason].title` and the canonical owner's
 * `RETURN_ORPHAN_BANNER_COPY.title`.
 */
export function readEntryField(content, name, key, field) {
  const parsed = parseEntrySegments(content, name);
  if (!parsed) return null;
  const entry = parsed.entries.find((e) => e.key === key);
  return entry ? stringField(entry.segment, field) : null;
}

/** Pure differ over two ordered vocabularies. */
export function diffValues(core, mirror, mirrorLabel) {
  const issues = [];
  const coreSet = new Set(core);
  const mirrorSet = new Set(mirror);

  const missingInMirror = core.filter((v) => !mirrorSet.has(v));
  const missingInCore = mirror.filter((v) => !coreSet.has(v));

  if (missingInMirror.length > 0) {
    issues.push(
      `present in core but MISSING from the ${mirrorLabel}: ${missingInMirror.map((v) => `'${v}'`).join(', ')}`,
    );
  }
  if (missingInCore.length > 0) {
    issues.push(
      `present in the ${mirrorLabel} but MISSING from core: ${missingInCore.map((v) => `'${v}'`).join(', ')}`,
    );
  }
  if (issues.length === 0 && core.join('|') !== mirror.join('|')) {
    issues.push(`same values but different order (core: ${core.join(', ')} / ${mirrorLabel}: ${mirror.join(', ')})`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Compare the per-reason `badge` + `counted` of two aligned entry sets. Call
 * only once the key vocabularies agree — a set difference is the better message.
 */
export function diffDescriptorFields(core, mirror, mirrorLabel) {
  const byKey = new Map(mirror.map((e) => [e.key, e]));
  const issues = [];

  for (const entry of core) {
    const other = byKey.get(entry.key);
    if (!other) continue;
    for (const field of ['badge', 'counted']) {
      if (entry[field] !== other[field]) {
        issues.push(
          `'${entry.key}'.${field}: core says ${JSON.stringify(entry[field])}, the ${mirrorLabel} says ${JSON.stringify(other[field])}`,
        );
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * M6's whole decision for ONE pair, as a pure function of both sides' resolved
 * values. Extracted (#2673) so every outcome is falsifiable offline.
 *
 * The loop below used to decide inline, which is how the `owner-declaration-
 * unreadable` arm came to mean "skip" for a whole wave without a single test
 * disagreeing: an arm reachable only through the filesystem is an arm no
 * fixture can pin. `--self-check` now asserts all four failure arms, and the
 * ONE that matters is that an unreadable owner declaration is a FAILURE — a
 * pair that resolves to nothing compares nothing, and must never be a note.
 *
 * `'ok'` is the only non-failing value. Anything else is recorded by main().
 */
export function classifyCrossFeatureTitle({ ours, fileExists, theirs }) {
  if (ours === null) return 'no-own-copy';
  if (!fileExists) return 'missing-file';
  if (theirs === null) return 'owner-declaration-unreadable';
  return theirs === ours ? 'ok' : 'drifted';
}

/**
 * Every value {@link classifyCrossFeatureTitle} can return, and whether it
 * passes. Declared as DATA rather than left implicit in a `switch`, so
 * `--self-check` can assert that exactly one outcome passes and that main()
 * handles every other one — which is what makes "no pair can resolve to a skip"
 * a checked property instead of a claim about one key name (#2673).
 */
export const CROSS_FEATURE_TITLE_OUTCOMES = Object.freeze({
  'no-own-copy': false,
  'missing-file': false,
  'owner-declaration-unreadable': false,
  drifted: false,
  ok: true,
});

async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function main() {
  const [coreContent, feMirrorContent, feCopyContent] = await Promise.all([
    readFile(join(repoRoot, CORE_FILE), 'utf8'),
    readFile(join(repoRoot, FE_MIRROR_FILE), 'utf8'),
    readFile(join(repoRoot, FE_COPY_FILE), 'utf8'),
  ]);

  const fatal = [];
  const drifts = [];

  const need = (parsed, label) => {
    if (!parsed || parsed.values.length === 0) { fatal.push(label); return null; }
    return parsed;
  };
  const needEntries = (parsed, label) => {
    if (!parsed || parsed.entries.length === 0) { fatal.push(label); return null; }
    return parsed;
  };

  const coreReasons = need(parseValues(coreContent, REASON_DECLARATION), `${CORE_FILE}: no '${REASON_DECLARATION}' array with string literals`);
  const feReasons = need(parseValues(feMirrorContent, REASON_DECLARATION), `${FE_MIRROR_FILE}: no '${REASON_DECLARATION}' array with string literals`);
  const coreBadges = need(parseValues(coreContent, BADGE_DECLARATION), `${CORE_FILE}: no '${BADGE_DECLARATION}' array with string literals`);
  const feBadges = need(parseValues(feMirrorContent, BADGE_DECLARATION), `${FE_MIRROR_FILE}: no '${BADGE_DECLARATION}' array with string literals`);
  const coreDesc = needEntries(parseDescriptorEntries(coreContent, CORE_DESCRIPTORS), `${CORE_FILE}: no '${CORE_DESCRIPTORS}' object literal`);
  const feDesc = needEntries(parseDescriptorEntries(feMirrorContent, FE_DESCRIPTORS), `${FE_MIRROR_FILE}: no '${FE_DESCRIPTORS}' object literal`);
  const feReasonCopy = need(parseObjectKeys(feCopyContent, FE_REASON_COPY), `${FE_COPY_FILE}: no '${FE_REASON_COPY}' object literal`);
  const feBadgeCopy = need(parseObjectKeys(feCopyContent, FE_BADGE_COPY), `${FE_COPY_FILE}: no '${FE_BADGE_COPY}' object literal`);

  if (fatal.length > 0) {
    console.error('✗ check-attention-reason-mirror: could not locate every declaration.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error(`\n  docs: ${DOCS_REF}\n`);
    process.exit(1);
  }

  const record = (rule, locations, issues) => drifts.push({ rule, locations, issues });

  // M1 — the reason vocabulary.
  const m1 = diffValues(coreReasons.values, feReasons.values, `${FE_MIRROR_FILE} mirror`);
  if (!m1.ok) {
    record(`${REASON_DECLARATION} must be identical, in the same order, in core and the frontend mirror`,
      [`${CORE_FILE}:${coreReasons.line}  (authoritative)`, `${FE_MIRROR_FILE}:${feReasons.line}  (hand-maintained mirror)`], m1.issues);
  }

  // M2 — the badge vocabulary.
  const m2 = diffValues(coreBadges.values, feBadges.values, `${FE_MIRROR_FILE} mirror`);
  if (!m2.ok) {
    record(`${BADGE_DECLARATION} must be identical, in the same order, in core and the frontend mirror`,
      [`${CORE_FILE}:${coreBadges.line}  (authoritative)`, `${FE_MIRROR_FILE}:${feBadges.line}  (hand-maintained mirror)`], m2.issues);
  }

  // M3 — per-reason badge + counted.
  const m3Keys = diffValues(coreDesc.entries.map((e) => e.key), feDesc.entries.map((e) => e.key), FE_DESCRIPTORS);
  if (!m3Keys.ok) {
    record(`${FE_DESCRIPTORS} must carry exactly one entry per ${CORE_DESCRIPTORS} entry, in the same order`,
      [`${CORE_FILE}:${coreDesc.line}  (authoritative)`, `${FE_MIRROR_FILE}:${feDesc.line}  (hand-maintained mirror)`], m3Keys.issues);
  } else {
    const m3Fields = diffDescriptorFields(coreDesc.entries, feDesc.entries, FE_DESCRIPTORS);
    if (!m3Fields.ok) {
      record("each reason's badge and counted must equal core's descriptor entry",
        [`${CORE_FILE}:${coreDesc.line}  (authoritative)`, `${FE_MIRROR_FILE}:${feDesc.line}  (hand-maintained mirror)`], m3Fields.issues);
    }
  }

  // M4 — copy covers every reason.
  const m4 = diffValues(coreReasons.values, feReasonCopy.values, FE_REASON_COPY);
  if (!m4.ok) {
    record(`${FE_REASON_COPY} must carry exactly one entry per ${REASON_DECLARATION} member, in the same order`,
      [`${CORE_FILE}:${coreReasons.line}  (authoritative)`, `${FE_COPY_FILE}:${feReasonCopy.line}  (operator copy)`], m4.issues);
  }

  // M5 — badge labels cover every badge value.
  const m5 = diffValues(coreBadges.values, feBadgeCopy.values, FE_BADGE_COPY);
  if (!m5.ok) {
    record(`${FE_BADGE_COPY} must carry exactly one entry per ${BADGE_DECLARATION} member, in the same order`,
      [`${CORE_FILE}:${coreBadges.line}  (authoritative)`, `${FE_COPY_FILE}:${feBadgeCopy.line}  (operator copy)`], m5.issues);
  }

  // M6 — cross-feature title agreement. The DECISION is `classifyCrossFeature
  // Title`; this loop only resolves the two sides and renders the outcome. Every
  // outcome but 'ok' is recorded, so nothing here can resolve to a skip (#2673).
  const compared = [];
  for (const pair of CROSS_FEATURE_TITLES) {
    const ours = readEntryField(feCopyContent, FE_REASON_COPY, pair.reason, 'title');
    const abs = join(repoRoot, pair.file);
    const fileExists = await stat(abs).then((st) => st.isFile(), () => false);
    const theirs = fileExists
      ? readEntryField((await readIfPresent(abs)) ?? '', pair.declaration, pair.field, pair.field)
      : null;

    switch (classifyCrossFeatureTitle({ ours, fileExists, theirs })) {
      case 'no-own-copy':
        record('a cross-feature title pair must name a reason this feature actually declares copy for',
          [`${FE_COPY_FILE}  (${FE_REASON_COPY}['${pair.reason}'].title)`],
          [`'${pair.reason}' has no readable title here — the pair would compare nothing; ` +
            'fix the reason key, or remove the pair']);
        break;
      case 'missing-file':
        record('a cross-feature title pair must name a file that exists (a typo here would pass forever)',
          [`${pair.file}  (declared canonical owner for '${pair.reason}')`],
          ['the file does not exist — fix the declared path, or remove the pair']);
        break;
      case 'owner-declaration-unreadable':
        record(`the canonical owner must declare '${pair.declaration}.${pair.field}'`,
          [`${pair.file}  (canonical owner for '${pair.reason}')`],
          [`'${pair.declaration}.${pair.field}' cannot be read — renamed, moved, or never written. ` +
            'A pair that resolves to nothing compares nothing, so this is a failure and not a note; ' +
            're-point the pair at the real declaration, or remove it']);
        break;
      case 'drifted':
        record(`the '${pair.reason}' title must be byte-identical to its canonical owner (spec § 4.2)`,
          [`${FE_COPY_FILE}  (${FE_REASON_COPY}['${pair.reason}'].title)`,
            `${pair.file}  (${pair.declaration}.${pair.field}, canonical owner)`],
          [`this feature says '${ours}', the owner says '${theirs}' — two sentences for one state`]);
        break;
      default:
        compared.push(`'${pair.reason}' = ${JSON.stringify(ours)}  <- ${pair.file} (${pair.declaration}.${pair.field})`);
    }
  }

  if (drifts.length === 0) {
    console.log(
      `✓ check-attention-reason-mirror: ${coreReasons.values.length} reason(s) and ` +
        `${coreBadges.values.length} badge(s) identical and in order across ${CORE_FILE}, ` +
        `${FE_MIRROR_FILE} and ${FE_COPY_FILE} (badge + counted included).`,
    );
    console.log(`  ${compared.length} cross-feature title(s) byte-identical to their canonical owner:`);
    for (const line of compared) console.log(`    ${line}`);
    process.exit(0);
  }

  console.error(`✗ check-attention-reason-mirror: ${drifts.length} drifted mirror(s).\n`);
  for (const { rule, locations, issues } of drifts) {
    for (const location of locations) console.error(`    ${location}`);
    console.error(`      rule: ${rule}`);
    for (const issue of issues) console.error(`        - ${issue}`);
    console.error('');
  }
  console.error(`    docs: ${DOCS_REF}\n`);
  process.exit(1);
}

/** Self-test the pure parsers + differs against synthetic inputs, including drifted fixtures. */
function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
  };

  const arr = (name, entries) => `/** h */\nexport const ${name} = [\n${entries}\n] as const;\n`;

  // --- parser: vocabulary arrays ---------------------------------------------
  const parsed = parseValues(arr(REASON_DECLARATION, "  'availability-unknown',\n  'return-unmatched',"), REASON_DECLARATION);
  expect('parses hyphenated literals', parsed?.values.join(','), 'availability-unknown,return-unmatched');
  expect('reports the declaration line', parsed?.line, 2);
  expect('strips per-member doc comments',
    parseValues(arr(REASON_DECLARATION, "  /** A1 — 'ghost'. */\n  'availability-unknown',\n  // 'ghost2'\n  'return-unmatched',"), REASON_DECLARATION)?.values.join(','),
    'availability-unknown,return-unmatched');
  expect('selects the requested declaration, not the first',
    parseValues(arr(BADGE_DECLARATION, "  'stopped',") + arr(REASON_DECLARATION, "  'availability-unknown',"), REASON_DECLARATION)?.values.join(','),
    'availability-unknown');
  expect('absent declaration -> null', parseValues('export const X = 1;', REASON_DECLARATION), null);
  expect('present but empty -> zero values (a FATAL, never a pass)', parseValues(arr(REASON_DECLARATION, ''), REASON_DECLARATION)?.values.length, 0);

  // --- parser: the nested, hyphen-keyed descriptor map -----------------------
  const descriptorSource =
    `export const ${CORE_DESCRIPTORS}: Readonly<Record<R, D>> =\n  Object.freeze({\n` +
    "    'availability-unknown': Object.freeze({\n      specRow: 'A1-U',\n      badge: 'stopped',\n      counted: true,\n    }),\n" +
    "    'line-unfulfillable': Object.freeze({\n      specRow: 'UF-L',\n      badge: 'at-risk',\n      counted: false,\n    }),\n  });\n";
  const desc = parseDescriptorEntries(descriptorSource, CORE_DESCRIPTORS);
  expect('reads depth-1 keys only', desc?.entries.map((e) => e.key).join(','), 'availability-unknown,line-unfulfillable');
  expect('does not mistake a nested badge/specRow line for a key', desc?.entries.length, 2);
  expect('reads each badge', desc?.entries.map((e) => e.badge).join(','), 'stopped,at-risk');
  expect('reads counted: true as a BOOLEAN', desc?.entries[0].counted, true);
  expect('reads counted: false as a BOOLEAN, not null', desc?.entries[1].counted, false);

  // --- differ: vocabularies --------------------------------------------------
  expect('identical -> ok', diffValues(['a', 'b'], ['a', 'b'], 'm').ok, true);
  expect('missing in mirror -> not ok', diffValues(['a', 'b'], ['a'], 'm').ok, false);
  expect('missing in core -> not ok', diffValues(['a'], ['a', 'b'], 'm').ok, false);
  expect('reordered -> not ok', diffValues(['a', 'b'], ['b', 'a'], 'm').ok, false);

  // --- differ: badge + counted, the arm the live repo CANNOT exercise --------
  const core2 = [{ key: 'a', badge: 'stopped', counted: true }];
  expect('same badge + counted -> ok', diffDescriptorFields(core2, [{ key: 'a', badge: 'stopped', counted: true }], 'm').ok, true);
  expect('DRIFTED badge -> not ok', diffDescriptorFields(core2, [{ key: 'a', badge: 'at-risk', counted: true }], 'm').ok, false);
  expect('DRIFTED counted (true vs false) -> not ok', diffDescriptorFields(core2, [{ key: 'a', badge: 'stopped', counted: false }], 'm').ok, false);
  expect('DRIFTED counted (false vs true) -> not ok',
    diffDescriptorFields([{ key: 'a', badge: 'stopped', counted: false }], [{ key: 'a', badge: 'stopped', counted: true }], 'm').ok, false);
  expect('counted unreadable on ONE side -> not ok (a null-vs-boolean must never compare equal)',
    diffDescriptorFields(core2, [{ key: 'a', badge: 'stopped', counted: null }], 'm').ok, false);

  // --- parser: object keys + a cross-feature title ---------------------------
  const copySource =
    `export const ${FE_REASON_COPY} = {\n` +
    "  'availability-unknown': {\n    title: \"We don't know how much stock to publish\",\n    body: 'b',\n  },\n" +
    "  'return-unmatched': {\n    title: 'This return is not matched to an order',\n    body: 'b',\n  },\n} satisfies Record<R, C>;\n";
  expect('reads copy-map keys in order', parseObjectKeys(copySource, FE_REASON_COPY)?.values.join(','), 'availability-unknown,return-unmatched');
  expect('reads one reason title from ITS OWN segment', readEntryField(copySource, FE_REASON_COPY, 'return-unmatched', 'title'), 'This return is not matched to an order');
  expect('reads a title containing an apostrophe (double-quoted)', readEntryField(copySource, FE_REASON_COPY, 'availability-unknown', 'title'), "We don't know how much stock to publish");
  expect('unknown reason title -> null', readEntryField(copySource, FE_REASON_COPY, 'nope', 'title'), null);
  // Segment scoping: reading entry 2's title must NOT return entry 1's.
  expect(
    'does NOT return the first title in the body for a later entry',
    readEntryField(copySource, FE_REASON_COPY, 'return-unmatched', 'title'),
    'This return is not matched to an order',
  );

  // --- M6's decision, every arm (#2673) ------------------------------------
  // THE arm this issue exists for. A pair keyed on a declaration name that is
  // not in the file it names resolves to `theirs === null`, and the old code
  // turned that null into a "pending" NOTE and passed while the two strings it
  // guarded drifted. It is a FAILURE, and these fixtures are the only artifact
  // in the repo that says so — a correctly-keyed live run can never reach it.
  expect('an unreadable owner declaration is a FAILURE, never a note',
    classifyCrossFeatureTitle({ ours: 'T', fileExists: true, theirs: null }), 'owner-declaration-unreadable');
  expect('a pair naming a reason this feature has no copy for is a FAILURE',
    classifyCrossFeatureTitle({ ours: null, fileExists: true, theirs: 'T' }), 'no-own-copy');
  expect('a pair naming a file that does not exist is a FAILURE',
    classifyCrossFeatureTitle({ ours: 'T', fileExists: false, theirs: null }), 'missing-file');
  expect('two different strings are a FAILURE',
    classifyCrossFeatureTitle({ ours: 'Stock was not added', fileExists: true, theirs: 'Stock was not added.' }), 'drifted');
  expect('two identical strings pass',
    classifyCrossFeatureTitle({ ours: 'T', fileExists: true, theirs: 'T' }), 'ok');
  // `ours === null` is tested FIRST, so a pair broken on both sides still
  // fails; reporting the missing file first would name the wrong fix.
  expect('a pair broken on BOTH sides still fails (never falls through to ok)',
    classifyCrossFeatureTitle({ ours: null, fileExists: false, theirs: null }), 'no-own-copy');

  // "No pair can resolve to a skip" — the real property. It replaces an earlier
  // `!('pending' in pair)` assertion that detected ONE key spelling while its
  // message claimed the whole escape hatch was gone.
  const M6_ARMS = ['no-own-copy', 'missing-file', 'owner-declaration-unreadable', 'drifted', 'ok'];
  expect('exactly one classifier outcome passes; every other is recorded',
    Object.values(CROSS_FEATURE_TITLE_OUTCOMES).filter(Boolean).length, 1);
  expect('the passing outcome is `ok`', CROSS_FEATURE_TITLE_OUTCOMES.ok, true);
  expect('the outcome table enumerates exactly the arms main() switches on',
    Object.keys(CROSS_FEATURE_TITLE_OUTCOMES).slice().sort().join(','), M6_ARMS.slice().sort().join(','));
  // A classifier that could only ever answer one value would satisfy every
  // assertion above and check nothing, so pin that it really reaches each arm.
  expect('the classifier reaches every declared outcome',
    new Set([
      classifyCrossFeatureTitle({ ours: null, fileExists: true, theirs: 'T' }),
      classifyCrossFeatureTitle({ ours: 'T', fileExists: false, theirs: null }),
      classifyCrossFeatureTitle({ ours: 'T', fileExists: true, theirs: null }),
      classifyCrossFeatureTitle({ ours: 'a', fileExists: true, theirs: 'b' }),
      classifyCrossFeatureTitle({ ours: 'T', fileExists: true, theirs: 'T' }),
    ]).size, M6_ARMS.length);
  expect('there is at least one cross-feature pair to compare', CROSS_FEATURE_TITLES.length > 0, true);
  // The parser half of the same regression: `readEntryField` must answer null
  // for a declaration name absent from the content it is handed.
  expect('a RENAMED/MOVED owner declaration reads as null',
    readEntryField(copySource, 'RETURNS_RESTOCK_BLOCKED_COPY', 'title', 'title'), null);

  const ownerSource = "export const RETURN_ORPHAN_BANNER_COPY = {\n  title: 'This return is not matched to an order',\n  safeHere: 'x',\n} as const;\n";
  expect('reads the canonical owner field', readEntryField(ownerSource, 'RETURN_ORPHAN_BANNER_COPY', 'title', 'title'), 'This return is not matched to an order');
  expect('DRIFTED cross-feature title is detectable',
    readEntryField(ownerSource.replace('not matched to an order', 'unmatched'), 'RETURN_ORPHAN_BANNER_COPY', 'title', 'title')
      === readEntryField(copySource, FE_REASON_COPY, 'return-unmatched', 'title'),
    false);

  if (failures.length > 0) {
    console.error('✗ check-attention-reason-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-attention-reason-mirror --self-check: parsers + differs behave (incl. drifted badge/counted/title fixtures).');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-attention-reason-mirror: fatal error:', err);
    process.exit(1);
  });
}

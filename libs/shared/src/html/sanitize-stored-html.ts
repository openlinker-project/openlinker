/**
 * Sanitize Stored HTML
 *
 * The inbound boundary for description HTML: everything OpenLinker PERSISTS
 * goes through here (#2198). Two entry points feed it - an operator's content
 * draft, and a product master's own description arriving through a
 * `ProductMasterPort` - and neither was sanitized before, which was harmless
 * only for as long as no frontend surface rendered a description as HTML.
 *
 * The `sanitize-html` version history and how its ESM transitive was made to
 * run under Jest 29 is explained in `docs/lessons.md` ("An exact dependency
 * pin whose reason lives only in a source comment…") as well as below - a
 * bump PR reads the manifest, not this file.
 *
 * ## This is the XSS boundary, unlike `applyDescriptionFormat`
 *
 * There are two passes over description HTML and conflating them is how the
 * previous implementation ended up doing neither well:
 *
 * - **This one** removes script vectors from untrusted input, on the way IN,
 *   with a real parser. It is deliberately WIDER than any destination format:
 *   a master shop legitimately stores tables, spans and inline styles, and
 *   narrowing here would destroy content the operator owns.
 * - `applyDescriptionFormat` (`@openlinker/core/listings`) shapes an
 *   already-safe value for one destination's grammar, on the way OUT, with a
 *   tag walker. It is not a security boundary and says so.
 *
 * ## Why `sanitize-html` and not the tag walker
 *
 * An allowlist that must survive hostile input needs a real parser: mutation
 * XSS, malformed nesting and attribute-splitting tricks all defeat regexes, and
 * a hand-rolled sanitizer is precisely the thing not to write. `sanitize-html`
 * is MIT, maintained, and parser-backed (`htmlparser2`). The cost is a
 * transitive `htmlparser2` + `postcss` install for every package that depends
 * on `@openlinker/shared`; that is accepted rather than hand-rolling this.
 *
 * ## Why the version was pinned, and why it moved (#2233)
 *
 * `sanitize-html` was pinned to `2.17.5` exactly in `package.json` because,
 * from `2.17.6`, it depends on `htmlparser2@^12`, which is ESM-only. Node 22
 * loads that fine (`require(esm)`), so this was purely a TEST-RUNNER
 * constraint: Jest 29's CJS runtime cannot `require` it, and every suite that
 * transitively loads this module failed with "Cannot use import statement
 * outside a module". `2.17.5` resolved `htmlparser2@^10`, which ships a
 * CommonJS build.
 *
 * The pin was a liability, not a preference: a stored-XSS advisory
 * (GHSA-g8qq-57p8-ggw5, SVG SMIL URI-list scheme-policy bypass) landed
 * against every `sanitize-html` version up to and including `2.17.6`,
 * patched in `2.17.7`. Per the rule this file states, the pin was lifted
 * immediately (#2233) rather than waiting for the ESM/Jest question to be
 * solved separately. Every jest config whose module graph can reach
 * `@openlinker/shared/html` now runs the ESM-only closure `sanitize-html@2.17.7`
 * pulls in (`htmlparser2`, `domutils`, `dom-serializer`, `domhandler`,
 * `domelementtype`, `entities`) through `babel-jest` (config: repo-root
 * `babel.esm-deps.cjs`) instead of ts-jest, with a `transformIgnorePatterns`
 * override scoped to exactly those packages (matched against pnpm's
 * `.pnpm/<pkg>@<version>/...` store layout). Every other file under
 * `node_modules` stays untransformed as before. The merge is shared via the
 * repo-root `jest.esm-deps.cjs` — that file, not this comment, is the source
 * of truth for the exact package list and the fan-out across jest configs;
 * `scripts/check-jest-esm-deps.mjs` (run under `pnpm check:invariants`)
 * enforces that every jest config reachable from `@openlinker/shared` merges
 * it in.
 *
 * `sanitize-html` now carries no exact pin - a caret range is safe again.
 * The next `pnpm audit` re-check for this boundary is whenever Dependabot (or
 * a manual bump) next touches `sanitize-html` or its transitive closure.
 *
 * DOMPurify is the browser-side counterpart and is NOT usable here: its own
 * README states Node use requires a current jsdom and that `happy-dom` is not
 * considered safe. The frontend sanitizes again before render (#2199) - two
 * passes, because stored data predating this boundary must not be trusted.
 *
 * @module libs/shared/src/html
 */
import sanitizeHtml from 'sanitize-html';

/**
 * Tags a product description may legitimately contain. Wider than any
 * `DescriptionFormat`, on purpose: PrestaShop and WooCommerce editors really do
 * produce tables, spans and headings, and this pass exists to remove script
 * vectors rather than to enforce a marketplace's taste.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'small', 'mark',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'blockquote', 'pre', 'code', 'abbr', 'cite', 'q',
] as const;

/**
 * `style` and `class` are allowed through because a shop's stored description
 * carries them and stripping them would silently rewrite the operator's own
 * catalogue. They are safe to KEEP but not safe to RENDER unreviewed, which is
 * why the browser sanitizes again; `applyDescriptionFormat` drops them per
 * destination on the way out.
 */
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  '*': ['style', 'class', 'title', 'dir', 'lang'],
  a: ['href', 'target', 'rel', 'name'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  td: ['colspan', 'rowspan', 'align', 'valign'],
  th: ['colspan', 'rowspan', 'align', 'valign', 'scope'],
  col: ['span', 'width'],
  table: ['border', 'cellpadding', 'cellspacing', 'width', 'summary'],
  ol: ['start', 'type'],
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: ALLOWED_ATTRIBUTES,
  // Only real navigable/embeddable schemes. `javascript:` and `vbscript:` are
  // excluded by omission; `data:` is excluded because a data URL is an
  // execution vector on an anchor and an exfiltration vector on an image.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  // A relative URL carries no scheme and stays usable (shop-relative images).
  allowProtocolRelative: false,
  // Drop the CONTENT of these as well as the tags - the default keeps the text
  // of a <script> body, which would leave the source of an attack readable in
  // an operator-facing field even though it can no longer execute.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed'],
  // `sanitize-html` strips every `on*` handler by virtue of the attribute
  // allowlist above; nothing extra is needed for that.
  disallowedTagsMode: 'discard',
};

/**
 * Remove script vectors from HTML that is about to be PERSISTED.
 *
 * Returns `null` for `null` / `undefined` so a caller can pass an optional
 * field straight through, and preserves an empty string as an empty string -
 * "the operator cleared the description" is a different fact from "there is no
 * description", and collapsing them here would silently change stored state.
 */
export function sanitizeStoredHtml(html: string): string;
export function sanitizeStoredHtml(html: string | null | undefined): string | null;
export function sanitizeStoredHtml(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null;
  if (html === '') return '';
  return sanitizeHtml(html, OPTIONS);
}

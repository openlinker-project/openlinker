/**
 * Apply Description Format
 *
 * The single enforcement pass for a destination's declared `DescriptionFormat`
 * (ADR-046). Pure and synchronous: no I/O, no injected dependencies, no clock.
 * Mirrors the shape of the existing pure helpers this repo already leans on -
 * `applyPricingRule`, `applyStockSafetyBuffer`, `checkRequiredToSell`.
 *
 * It replaces `sanitizeAllegroDescription`, whose allowlist admitted five tags
 * Allegro rejects. Every destination-specific rule that lived in that regex is
 * now data on the format object, so the same code serves Allegro, Erli and
 * WooCommerce.
 *
 * ## Scope: this is a shaping pass, not a security boundary
 *
 * The tokenizer below walks tags with a regex and maintains a parent stack. It
 * is adequate for its job because both producers of its input are
 * well-formed - the rich-text editor emits well-formed markup, and a shop's
 * WYSIWYG (PrestaShop TinyMCE, WooCommerce) does too - and because the output
 * alphabet is tiny (seven to nine tags, usually zero attributes).
 *
 * It is deliberately NOT the XSS defence. Untrusted description HTML is
 * sanitized with a real parser at the inbound API boundary (#2198), which is
 * also where anything reaching a browser is cleaned again before render. A
 * regex walker must never be the only thing between a hostile input and a
 * page; conflating "shape this for the destination" with "make this safe" is
 * how the previous implementation ended up doing neither well.
 *
 * Malformed input degrades predictably rather than throwing: an unclosed tag
 * is dropped when the stack unwinds, and a stray close tag with no matching
 * open is discarded.
 *
 * @module libs/core/src/listings/application/services
 * @see {@link DescriptionFormat} for the contract this enforces
 */
import {
  DESCRIPTION_BLOCK_TAGS,
  type DescriptionFormat,
  type DescriptionRewrite,
} from '../../domain/types/description-format.types';

/** The block element a format's `requiresBlockOpener` wrap introduces. */
const IMPLICIT_WRAP_TAG = 'p';

/** Void elements that can appear in a description. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'wbr']);

/** `<tag …>` / `</tag>` / `<tag … />`, plus the raw text between them. */
const TAG_PATTERN = /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/)?\s*>/g;
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;

interface RewriteResolution {
  /** Tag name to emit, or `null` to drop the tag and keep its text. */
  readonly emitAs: string | null;
  /** Replace the element with a paragraph break instead of emitting a tag. */
  readonly splitBlock: boolean;
}

function resolveRewrite(
  tag: string,
  rewrites: readonly DescriptionRewrite[] | undefined,
): RewriteResolution {
  for (const rule of rewrites ?? []) {
    if (rule.from.toLowerCase() !== tag) continue;
    if (rule.action === 'rename') return { emitAs: rule.to.toLowerCase(), splitBlock: false };
    if (rule.action === 'unwrap') return { emitAs: null, splitBlock: false };
    return { emitAs: null, splitBlock: true };
  }
  return { emitAs: tag, splitBlock: false };
}

function renderAttributes(
  tag: string,
  rawAttributes: string,
  format: DescriptionFormat,
): string {
  const allowed = format.allowedAttributes?.[tag];
  if (allowed === undefined || allowed.length === 0) return '';
  const out: string[] = [];
  let match: RegExpExecArray | null;
  ATTRIBUTE_PATTERN.lastIndex = 0;
  while ((match = ATTRIBUTE_PATTERN.exec(rawAttributes)) !== null) {
    const name = match[1].toLowerCase();
    if (!allowed.includes(name)) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    // A URL-bearing attribute must not carry a scheme the destination would
    // render as script. Cheap and local; the real check is #2198's parser.
    if (/^\s*(javascript|data|vbscript):/i.test(value)) continue;
    out.push(`${name}="${value.replace(/"/g, '&quot;')}"`);
  }
  return out.length > 0 ? ` ${out.join(' ')}` : '';
}

/**
 * Is `tag` permitted inside `parent` (or at the root when `parent` is
 * undefined)? A format with no `contentModel` answers from `allowedTags`
 * alone; a parent with no entry in the model is unconstrained.
 */
function isAllowedIn(
  tag: string,
  parent: string | undefined,
  format: DescriptionFormat,
): boolean {
  if (!format.allowedTags.includes(tag)) return false;
  const model = format.contentModel;
  if (model === undefined || model === null) return true;
  const key = parent ?? 'root';
  const allowed = model[key];
  if (allowed === undefined) return true;
  if (allowed.includes(tag)) return true;

  // Root-level inline content is judged against the paragraph it is about to
  // be wrapped in, not against the root. Without this, `<b>bold</b>` on a
  // format whose root accepts only blocks loses the operator's emphasis and
  // then gets wrapped into the very paragraph where `b` is legal - a silent,
  // pointless downgrade. `sanitizeAllegroDescription` got this right (#540),
  // so dropping it would have been a regression.
  if (parent === undefined && format.requiresBlockOpener === true) {
    return (model[IMPLICIT_WRAP_TAG] ?? []).includes(tag);
  }
  return false;
}

function capBytes(html: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes <= maxBytes) return html;
  let used = 0;
  let cutAt = 0;
  for (let i = 0; i < html.length; i++) {
    const charBytes = Buffer.byteLength(html[i], 'utf8');
    if (used + charBytes > maxBytes) break;
    used += charBytes;
    cutAt = i + 1;
  }
  // Cut at the last '>' inside the budget so a half-open tag never ships.
  const lastGt = html.lastIndexOf('>', cutAt - 1);
  return lastGt >= 0 ? html.slice(0, lastGt + 1) : html.slice(0, cutAt);
}

function stripTags(html: string): string {
  return html.replace(TAG_PATTERN, '').replace(/\s+/g, ' ').trim();
}

/**
 * Shape `html` into what `format`'s destination accepts.
 *
 * Returns `''` for input that carries no text, so callers can treat an empty
 * result as "no description" rather than shipping bare whitespace or an empty
 * wrapper.
 */
export function applyDescriptionFormat(html: string, format: DescriptionFormat): string {
  if (html.trim() === '') return '';
  if (format.shape === 'plain-text') {
    const text = stripTags(html);
    return format.maxBytes != null ? capBytes(text, format.maxBytes) : text;
  }

  const out: string[] = [];
  /**
   * Open elements actually emitted, innermost last. A dropped tag never enters
   * this stack, so its close tag finds no match and is discarded on its own -
   * no separate bookkeeping is needed for suppressed elements.
   */
  const stack: string[] = [];

  const parentOf = (): string | undefined => stack[stack.length - 1];

  let cursor = 0;
  let match: RegExpExecArray | null;
  TAG_PATTERN.lastIndex = 0;
  while ((match = TAG_PATTERN.exec(html)) !== null) {
    out.push(html.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const isClosing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const rawAttributes = match[3] ?? '';
    const selfClosed = match[4] === '/';

    const { emitAs, splitBlock } = resolveRewrite(tag, format.rewrites);

    if (isClosing) {
      if (emitAs === null) continue;
      const openIndex = stack.lastIndexOf(emitAs);
      if (openIndex === -1) continue; // stray close, or its open was dropped
      // Close anything left open inside it, innermost first.
      while (stack.length > openIndex) {
        const open = stack.pop();
        if (open !== undefined && !VOID_TAGS.has(open)) out.push(`</${open}>`);
      }
      continue;
    }

    if (splitBlock) {
      // `split-block` substitutes a paragraph break, which is only meaningful
      // inside a paragraph - Allegro's own guidance for the `<br>` it rejects
      // is literally "use `<p></p>`". Splitting any other parent would change
      // the document's meaning rather than its line breaks: inside `<li>` it
      // would silently create a second bullet, and inside `<ul>` it would end
      // the list. Anywhere but a paragraph the tag is dropped and the text
      // flows on, which loses a line break but never invents structure.
      if (parentOf() === 'p') out.push('</p><p>');
      continue;
    }

    if (emitAs === null || !isAllowedIn(emitAs, parentOf(), format)) {
      continue; // drop the tag, keep its text
    }

    const isVoid = VOID_TAGS.has(emitAs);
    const attributes = renderAttributes(emitAs, rawAttributes, format);
    if (isVoid) {
      out.push(format.selfClosingVoids === true ? `<${emitAs}${attributes}/>` : `<${emitAs}${attributes}>`);
      continue;
    }
    if (selfClosed) {
      out.push(`<${emitAs}${attributes}></${emitAs}>`);
      continue;
    }
    out.push(`<${emitAs}${attributes}>`);
    stack.push(emitAs);
  }
  out.push(html.slice(cursor));

  // Unwind anything the input left open.
  while (stack.length > 0) {
    const open = stack.pop();
    if (open !== undefined && !VOID_TAGS.has(open)) out.push(`</${open}>`);
  }
  let result = collapseEmpty(out.join(''), format);
  if (result.trim() === '') return '';

  if (format.requiresBlockOpener === true) {
    result = wrapRootInlineRuns(result, format);
  }

  return format.maxBytes != null ? capBytes(result, format.maxBytes) : result;
}

/**
 * Remove elements the pass emptied out. A `<p></p>` left by a `split-block` at
 * a block boundary, or a `<b></b>` whose only child was dropped, is noise the
 * destination would render as a blank line.
 */
function collapseEmpty(html: string, format: DescriptionFormat): string {
  const voids = [...VOID_TAGS].join('|');
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = current.replace(
      new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*>(?:\\s|<(?:${voids})\\s*/?>)*</\\1>`, 'gi'),
      (whole, tag: string) => (format.allowedTags.includes(tag.toLowerCase()) ? '' : whole),
    );
  } while (current !== previous);
  return current;
}

/**
 * A format whose root accepts only block elements must not be handed loose
 * content. This wraps EVERY top-level run that is not a block element in the
 * implicit paragraph, not just the leading one.
 *
 * Wrapping only the leading run is not enough, and the failure is easy to miss:
 * a dropped `<table>` leaves its cell text at the root *after* the blocks, so
 * output like `<h1>T</h1><p>a</p>c` looks fine in review and is rejected by a
 * validator whose root set excludes text. `sanitizeAllegroDescription` had the
 * same gap - its block-opener test was positionless and only ever looked at the
 * start of the string.
 *
 * Wrapping the whole string instead would nest blocks
 * (`<p><b>a</b><p>c</p></p>`), which the content model then rejects, so the
 * runs have to be found individually. One pass, depth-tracked, no re-parse.
 */
function wrapRootInlineRuns(html: string, format: DescriptionFormat): string {
  const openers = format.contentModel?.root ?? DESCRIPTION_BLOCK_TAGS;
  const isBlock = (tag: string): boolean => openers.some((o) => o.toLowerCase() === tag);

  const out: string[] = [];
  /** Loose top-level content collected since the last block element. */
  let loose = '';
  let depth = 0;
  let cursor = 0;

  const flushLoose = (): void => {
    if (loose.trim() !== '') {
      out.push(`<${IMPLICIT_WRAP_TAG}>${loose.trim()}</${IMPLICIT_WRAP_TAG}>`);
    }
    loose = '';
  };

  let match: RegExpExecArray | null;
  TAG_PATTERN.lastIndex = 0;
  while ((match = TAG_PATTERN.exec(html)) !== null) {
    const text = html.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    if (depth === 0) loose += text;
    else out.push(text);

    const isClosing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const selfContained = match[4] === '/' || VOID_TAGS.has(tag);

    if (!isClosing && depth === 0 && isBlock(tag) && !selfContained) {
      // A top-level block starts here: everything loose before it becomes a
      // paragraph of its own, and the block passes through untouched.
      flushLoose();
      out.push(match[0]);
      depth = 1;
      continue;
    }

    if (depth === 0) {
      loose += match[0];
      continue;
    }

    out.push(match[0]);
    if (selfContained) continue;
    depth += isClosing ? -1 : 1;
    if (depth < 0) depth = 0;
  }

  const tail = html.slice(cursor);
  if (depth === 0) loose += tail;
  else out.push(tail);
  flushLoose();

  return out.join('');
}

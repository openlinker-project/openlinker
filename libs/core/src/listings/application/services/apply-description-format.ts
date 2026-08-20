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
/**
 * Comment, CDATA, doctype and processing-instruction spans.
 *
 * `TAG_PATTERN` requires `<[a-zA-Z]`, so none of these is a tag to the walker:
 * they would survive as TEXT and then be wrapped into a paragraph, shipping
 * `<p><!-- wp:paragraph --></p>` to a destination whose grammar has no comment
 * production. That is not hypothetical - a WooCommerce master's `post_content`
 * carries Gutenberg block comments as a matter of course, and the builders read
 * the description from a LIVE master call that never passes through
 * `sanitizeStoredHtml` (which would have stripped them).
 */
const MARKUP_NOISE_PATTERN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>/g;
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;

interface RewriteResolution {
  /** Tag name to emit, or `null` to drop the tag and keep its text. */
  readonly emitAs: string | null;
  /** Replace the element with a paragraph break instead of emitting a tag. */
  readonly splitBlock: boolean;
}

/**
 * Compile-time exhaustiveness for the rewrite union.
 *
 * Reached only if a new `DescriptionRewriteAction` is added without a case here,
 * which the compiler then rejects - the point being that a bare fallthrough
 * silently treated an unknown action as `split-block`, i.e. invented structure.
 */
function assertUnreachableRewrite(rule: never): never {
  throw new Error(`unhandled description rewrite: ${JSON.stringify(rule)}`);
}

function resolveRewrite(
  tag: string,
  rewrites: readonly DescriptionRewrite[] | undefined,
): RewriteResolution {
  for (const rule of rewrites ?? []) {
    if (rule.from.toLowerCase() !== tag) continue;
    // Exhaustive on purpose: a bare fallthrough would silently treat a future
    // action as `split-block`, which invents structure rather than failing.
    switch (rule.action) {
      case 'rename':
        return { emitAs: rule.to.toLowerCase(), splitBlock: false };
      case 'unwrap':
        return { emitAs: null, splitBlock: false };
      case 'split-block':
        return { emitAs: null, splitBlock: true };
      default:
        return assertUnreachableRewrite(rule);
    }
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
  if (allowed === undefined) {
    // A parent the model does not mention is an INLINE context, so it accepts
    // exactly what the implicit paragraph accepts - not "anything".
    //
    // Two payloads made this necessary, both ordinary shop HTML. `<b>a<p>c</p></b>`
    // used to emit a block inside an inline, and the root-inline wrap then split
    // the run through the still-open `<b>`: `<p><b>a</p><p>c</p><p></b></p>` -
    // cross-nested, with a stray close tag. And `<b>a<ul><li>x</li></ul></b>`
    // dropped the `<ul>` but kept a bare `<li>`, which is structurally
    // meaningless outside a list. Judging against the paragraph's own child set
    // rejects both while keeping every character of text.
    return (model[IMPLICIT_WRAP_TAG] ?? []).includes(tag);
  }
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

/**
 * Cap plain text at a byte budget, cutting on a CODE POINT boundary.
 *
 * Indexing by UTF-16 unit would cut an astral character in half and ship a lone
 * surrogate, which is invalid UTF-8 and does not survive JSON serialisation -
 * emoji in a description are ordinary, so this is reachable.
 */
function capTextBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let used = 0;
  let out = '';
  for (const codePoint of text) {
    const size = Buffer.byteLength(codePoint, 'utf8');
    if (used + size > maxBytes) break;
    used += size;
    out += codePoint;
  }
  return out;
}

/**
 * Cap well-formed markup at a byte budget WITHOUT leaving an element open.
 *
 * Cutting at the last `>` inside the budget - the obvious approach - keeps a
 * half-written *tag* off the wire but happily ships a half-closed *element*:
 * a 40-byte budget over `<h1>Title</h1><p>xxx…` produced literally
 * `<h1>Title</h1><p>`, i.e. the unbalanced payload this whole contract exists
 * to prevent, and the adapter keeps no defensive second pass to catch it.
 *
 * So the budget is spent with the closers reserved: at every token the walk
 * checks that what it is about to emit still leaves room to close everything
 * currently open. When it does not, the walk stops and the stack is closed.
 */
function capHtmlBytes(html: string, maxBytes: number, format: DescriptionFormat): string {
  if (Buffer.byteLength(html, 'utf8') <= maxBytes) return html;

  const stack: string[] = [];
  const closersFor = (open: readonly string[]): string =>
    [...open]
      .reverse()
      .filter((tag) => !VOID_TAGS.has(tag))
      .map((tag) => `</${tag}>`)
      .join('');

  let out = '';
  let used = 0;
  /** Can `token` be added while still leaving room for `closers`? */
  const fits = (token: string, closers: string): boolean =>
    used + Buffer.byteLength(token, 'utf8') + Buffer.byteLength(closers, 'utf8') <= maxBytes;

  const emit = (token: string): void => {
    out += token;
    used += Buffer.byteLength(token, 'utf8');
  };

  let cursor = 0;
  let match: RegExpExecArray | null;
  let stopped = false;
  TAG_PATTERN.lastIndex = 0;
  while (!stopped && (match = TAG_PATTERN.exec(html)) !== null) {
    const text = html.slice(cursor, match.index);
    cursor = match.index + match[0].length;

    if (text !== '') {
      if (fits(text, closersFor(stack))) {
        emit(text);
      } else {
        // Partial text is fine - it is the only place a cut can land without
        // breaking structure. Budget for the closers first.
        const room = maxBytes - used - Buffer.byteLength(closersFor(stack), 'utf8');
        emit(capTextBytes(text, Math.max(0, room)));
        stopped = true;
        break;
      }
    }

    const isClosing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const selfContained = match[4] === '/' || VOID_TAGS.has(tag);
    const nextStack = isClosing
      ? stack.slice(0, Math.max(0, stack.lastIndexOf(tag)))
      : selfContained
        ? stack
        : [...stack, tag];

    if (!fits(match[0], closersFor(nextStack))) {
      stopped = true;
      break;
    }
    emit(match[0]);
    if (isClosing) {
      const openIndex = stack.lastIndexOf(tag);
      if (openIndex !== -1) stack.length = openIndex;
    } else if (!selfContained) {
      stack.push(tag);
    }
  }

  if (!stopped) {
    const tail = html.slice(cursor);
    const room = maxBytes - used - Buffer.byteLength(closersFor(stack), 'utf8');
    emit(capTextBytes(tail, Math.max(0, room)));
  }

  // Closing the stack can leave an element with nothing in it (the cut landed
  // right after its open tag), which the destination renders as a blank line.
  return collapseEmpty(out + closersFor(stack), format);
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
    const text = stripTags(html.replace(MARKUP_NOISE_PATTERN, ''));
    return format.maxBytes != null ? capTextBytes(text, format.maxBytes) : text;
  }

  // Dropped before the walk, not during it: see `MARKUP_NOISE_PATTERN`.
  const source = html.replace(MARKUP_NOISE_PATTERN, '');

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
  while ((match = TAG_PATTERN.exec(source)) !== null) {
    out.push(source.slice(cursor, match.index));
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
  out.push(source.slice(cursor));

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

  return format.maxBytes != null ? capHtmlBytes(result, format.maxBytes, format) : result;
}

/**
 * Remove elements the pass emptied out. A `<p></p>` left by a `split-block` at
 * a block boundary, or a `<b></b>` whose only child was dropped, is noise the
 * destination would render as a blank line.
 *
 * The open-tag pattern is attribute-aware (`"…"` / `'…'` runs are consumed
 * whole) rather than the shorter `[^>]*`, which would terminate on a `>` inside
 * an attribute value and then fail to recognise the element as empty. That is
 * unreachable today - this runs on walker output whose attributes come from a
 * tiny per-tag allowlist with `"` escaped to `&quot;` - but the cost of being
 * right anyway is one alternation, and the next person to widen
 * `allowedAttributes` to something free-form (`title`, `alt`) should not have to
 * discover the coupling.
 */
function collapseEmpty(html: string, format: DescriptionFormat): string {
  const voids = [...VOID_TAGS].join('|');
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = current.replace(
      new RegExp(
        `<([a-zA-Z][a-zA-Z0-9]*)\\b(?:"[^"]*"|'[^']*'|[^>"'])*>(?:\\s|<(?:${voids})\\s*/?>)*</\\1>`,
        'gi',
      ),
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

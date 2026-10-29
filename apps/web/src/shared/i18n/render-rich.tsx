/**
 * renderRich
 *
 * Renders a translated sentence that contains markup, so a link or a bold
 * word stays inside one translatable string instead of being split into
 * fragments: `'Read the <link>guide</link> first'` with
 * `{ link: (text) => <a href="...">{text}</a> }`. Tags do not nest. An
 * unknown tag is rendered as its plain text, never as HTML.
 *
 * Pass `{name}` values as the third argument instead of interpolating them
 * first: the tags are parsed before the values go in, so a server or provider
 * string containing `<b>` is shown as text and cannot become markup.
 *
 * @module shared/i18n
 */
import { Fragment, type ReactNode } from 'react';
import { interpolate, type InterpolationParams } from './interpolate';

export type RichParts = Readonly<Record<string, (chunk: string) => ReactNode>>;

// `[\s\S]`, not `.`: a translated sentence may wrap a tag across lines.
const TAG = /<(\w+)>([\s\S]*?)<\/\1>/g;

// Own keys only: `parts['constructor']` is `Object`, which would turn a
// `<constructor>` tag in server text into a render crash.
function ownPart(parts: RichParts, name: string): RichParts[string] | undefined {
  return Object.prototype.hasOwnProperty.call(parts, name) ? parts[name] : undefined;
}

export function renderRich(
  text: string,
  parts: RichParts,
  params?: InterpolationParams,
): ReactNode {
  const fill = (piece: string): string => (params ? interpolate(piece, params) : piece);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TAG)) {
    const [whole, name, chunk] = match;
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(fill(text.slice(cursor, start)));
    const render = ownPart(parts, name);
    const filled = fill(chunk);
    nodes.push(<Fragment key={start}>{render ? render(filled) : filled}</Fragment>);
    cursor = start + whole.length;
  }
  if (cursor < text.length) nodes.push(fill(text.slice(cursor)));
  return nodes.length === 1 ? nodes[0] : nodes;
}

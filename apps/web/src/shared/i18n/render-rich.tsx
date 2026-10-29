/**
 * renderRich
 *
 * Renders a translated sentence that contains markup, so a link or a bold
 * word stays inside one translatable string instead of being split into
 * fragments: `'Read the <link>guide</link> first'` with
 * `{ link: (text) => <a href="...">{text}</a> }`. Tags do not nest. An
 * unknown tag is rendered as its plain text, never as HTML.
 *
 * @module shared/i18n
 */
import { Fragment, type ReactNode } from 'react';

export type RichParts = Readonly<Record<string, (chunk: string) => ReactNode>>;

// `[\s\S]`, not `.`: a translated sentence may wrap a tag across lines.
const TAG = /<(\w+)>([\s\S]*?)<\/\1>/g;

export function renderRich(text: string, parts: RichParts): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TAG)) {
    const [whole, name, chunk] = match;
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const render = parts[name];
    nodes.push(<Fragment key={start}>{render ? render(chunk) : chunk}</Fragment>);
    cursor = start + whole.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length === 1 ? nodes[0] : nodes;
}

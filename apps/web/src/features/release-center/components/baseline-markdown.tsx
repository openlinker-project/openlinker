/**
 * Baseline markdown (#4147)
 *
 * The hand-written `0.1.0` block is kept as markdown, never parsed into
 * entries. This renders the small subset it uses (paragraphs, `###` headings,
 * `-` bullets, `**bold**`, backticks) as React nodes, so no HTML is injected.
 *
 * @module features/release-center/components
 */
import type { ReactElement, ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
      return part;
    });
}

export function BaselineMarkdown({ markdown }: { markdown: string }): ReactElement {
  const blocks: ReactElement[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  const flush = (): void => {
    if (paragraph.length) {
      blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>);
      paragraph = [];
    }
    if (bullets.length) {
      blocks.push(
        <ul key={blocks.length}>
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('### ')) {
      flush();
      blocks.push(<h4 key={blocks.length}>{line.slice(4)}</h4>);
    } else if (/^- /.test(line)) {
      if (paragraph.length) flush();
      bullets.push(line.slice(2));
    } else if (/^\s+\S/.test(line) && bullets.length) {
      bullets[bullets.length - 1] += ` ${line.trim()}`;
    } else if (line.trim() === '') {
      flush();
    } else {
      if (bullets.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return <div className="whats-new__baseline">{blocks}</div>;
}

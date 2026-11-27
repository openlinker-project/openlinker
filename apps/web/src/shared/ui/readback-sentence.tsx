/**
 * ReadbackSentence (#3935)
 *
 * What a form says, in one sentence, as it stands: "When an order from Allegro is
 * worth 200.00 zl or more, we add a free mug." It sits beside the form and
 * rewrites itself as the operator edits, so the operator reads back the rule they
 * are building, in words, before turning it on. The caller composes the sentence
 * (chips, bold values, placeholders for what is still missing); this only frames
 * it.
 *
 * @module shared/ui
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';

export interface ReadbackSentenceProps {
  eyebrow: string;
  /** The thing's name, above the sentence. */
  name?: ReactNode;
  children: ReactNode;
  /** A line under the sentence, e.g. the channels. */
  footer?: ReactNode;
  riseIndex?: number;
  className?: string;
  'data-testid'?: string;
}

export function ReadbackSentence({
  eyebrow,
  name,
  children,
  footer,
  riseIndex,
  className,
  'data-testid': testId,
}: ReadbackSentenceProps): ReactElement {
  const style = riseIndex === undefined ? undefined : ({ '--rise-i': riseIndex } as CSSProperties);
  return (
    <div
      className={['rule-composer-readback', riseIndex !== undefined ? 'pm-rise' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={style}
      data-testid={testId}
    >
      <p className="rule-composer-readback__eyebrow eyebrow">{eyebrow}</p>
      {name !== undefined ? <p className="pm-rb-name">{name}</p> : null}
      <p className="rule-composer-readback__sentence pm-sentence">{children}</p>
      {footer}
    </div>
  );
}

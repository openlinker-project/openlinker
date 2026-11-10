/**
 * ReadbackSentence
 *
 * The "in one sentence" card of a composer: the operator's choices read back
 * as plain prose, so they can check what they built without reading a form.
 * The sentence is `children` (use `<b>` for the parts that matter); it fades
 * when it changes unless the user prefers reduced motion.
 *
 * @module apps/web/src/shared/ui
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

export interface ReadbackSentenceProps {
  eyebrow: string;
  /** Heading line above the sentence (e.g. the bundle name). */
  name?: ReactNode;
  /** Plain-text key of the sentence: a change of key replays the fade. */
  sentenceKey: string;
  children: ReactNode;
  'data-testid'?: string;
}

export function ReadbackSentence({
  eyebrow,
  name,
  sentenceKey,
  children,
  'data-testid': testId,
}: ReadbackSentenceProps): ReactElement {
  const ref = useRef<HTMLParagraphElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 200 });
  }, [sentenceKey]);

  return (
    <div className="rule-composer-readback pm-rise" data-testid={testId}>
      <p className="rule-composer-readback__eyebrow eyebrow">{eyebrow}</p>
      {name ? <p className="pm-rb-name">{name}</p> : null}
      <p ref={ref} className="rule-composer-readback__sentence pm-sentence" aria-live="polite">
        {children}
      </p>
    </div>
  );
}

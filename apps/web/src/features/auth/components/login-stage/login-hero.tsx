/**
 * Login Hero
 *
 * The headline, the line under it and (in the demo) three check-marked
 * points. The demo headline rotates through the order sources OpenLinker
 * connects; a real install shows the admin's headline with its accent line
 * in the brand colour. Reduced motion shows the first word and no entrance
 * motion (#4029).
 *
 * @module features/auth/components/login-stage
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactElement } from 'react';
import type { LoginStageCopy } from '../../lib/login-stage-copy';
import { LOGIN_STAGE_EASE } from './login-stage-motion';

const ROTATE_EVERY_MS = 2600;

function RotatingWord({ words }: { words: string[] }): ReactElement {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduce) return undefined;
    const id = setInterval(() => setIndex((n) => (n + 1) % words.length), ROTATE_EVERY_MS);
    return () => clearInterval(id);
  }, [reduce, words]);
  const word = words[index % words.length] ?? '';
  return (
    <span className="login-hero__slot">
      <AnimatePresence initial={false}>
        <motion.span
          key={word}
          className="login-hero__word"
          initial={{ y: '100%' }}
          animate={{ y: '0%' }}
          exit={{ y: '-100%' }}
          transition={{ duration: 0.6, ease: LOGIN_STAGE_EASE }}
        >
          {word}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function LoginHero({ copy }: { copy: LoginStageCopy }): ReactElement {
  const reduce = useReducedMotion();
  const line = (n: number): Record<string, unknown> =>
    reduce
      ? {}
      : {
          initial: { y: '105%' },
          animate: { y: '0%' },
          transition: { duration: 0.85, ease: LOGIN_STAGE_EASE, delay: 0.08 + n * 0.08 },
        };
  const fade = (delay: number): Record<string, unknown> =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, ease: LOGIN_STAGE_EASE, delay },
        };
  const { lines, rotating, accent } = copy.headline;
  const spoken = `${lines.join(' ')} ${rotating ? rotating[0] ?? '' : accent ?? ''}`;

  return (
    <section className="login-hero">
      <h1 className="login-hero__title" aria-label={spoken}>
        {lines.map((text, i) => (
          <span key={`${i}-${text}`} className="login-hero__line" aria-hidden="true">
            <motion.span {...line(i)}>{text}</motion.span>
          </span>
        ))}
        <span className="login-hero__line" aria-hidden="true">
          <motion.span {...line(lines.length)}>
            {rotating ? (
              <RotatingWord words={rotating} />
            ) : (
              <span className="login-hero__accent">{accent}</span>
            )}
          </motion.span>
        </span>
      </h1>
      <motion.p className="login-hero__lead" {...fade(0.35)}>
        {copy.lead}
      </motion.p>
      {copy.highlights.length ? (
        <ul className="login-hero__highlights">
          {copy.highlights.map((text, i) => (
            <motion.li key={text} {...fade(0.45 + i * 0.07)}>
              <span className="login-hero__tick" aria-hidden="true" />
              {text}
            </motion.li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Login Top Bar
 *
 * The one header the login stage has in every mode (#4029). It is the same
 * header as openlinker.io: brand mark, then the language. The demo adds a
 * chip, one sentence saying where the visitor is, and links back to the
 * project. The sentence is shown only when all of it fits (`FitText`): a
 * cut-off sentence reads worse than none, so it is never ellipsised.
 *
 * It sticks to the top of the screen. Over the first 64 px of scroll it gets a
 * surface and settles into a slightly lower bar with slightly smaller brand
 * and switches: one 0..1 value tied directly to the scroll (no spring, so it
 * never lags the page) feeds transforms in CSS, and the bar keeps its slot, so
 * nothing below it moves.
 *
 * @module features/auth/components/login-stage
 */
import { motion, useScroll, useTransform } from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ThemeSwitch } from '../../../appearance';
import { LanguageSwitch } from '../../../language';
import type { LoginStageCopy } from '../../lib/login-stage-copy';
import { useMessages } from '../../../../shared/i18n';

export function LoginBrandMark({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 500 500" aria-hidden="true">
      <g transform="translate(250 250) rotate(-30)">
        <rect
          x="-72"
          y="-160"
          width="144"
          height="320"
          rx="72"
          fill="none"
          stroke="#ee8c3c"
          strokeWidth="42"
        />
      </g>
      <rect x="105" y="232" width="290" height="36" rx="18" fill="#ee8c3c" />
    </svg>
  );
}

function FitText({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}): ReactElement {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return undefined;
    const check = (): void => setFits(text.offsetWidth <= box.clientWidth);
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(check);
    observer.observe(box);
    observer.observe(text);
    return () => observer.disconnect();
  }, [children]);
  return (
    <span
      ref={boxRef}
      className={className}
      data-fits={fits ? 'true' : 'false'}
      aria-hidden={fits ? undefined : true}
    >
      <span ref={textRef}>{children}</span>
    </span>
  );
}

interface LoginTopBarProps {
  bar: LoginStageCopy['bar'];
}

/** Scroll, in px, over which the bar settles into its compact form. */
const SHRINK_OVER = 64;

export function LoginTopBar({ bar }: LoginTopBarProps): ReactElement {
  const brand = useMessages('app').brand;
  const { scrollY } = useScroll();
  const shrink = useTransform(scrollY, [0, SHRINK_OVER], [0, 1], { clamp: true });
  return (
    <motion.header
      className={bar ? 'login-topbar login-topbar--demo' : 'login-topbar login-topbar--plain'}
      style={{ '--topbar-shrink': shrink } as unknown as Record<string, unknown>}
    >
      <span className="login-topbar__surface" aria-hidden="true" />
      <div className="login-topbar__inner">
        <span className="login-topbar__brand">
          <LoginBrandMark />
          {brand.name}
        </span>
        {bar ? (
          <>
            <span className="login-topbar__chip">
              <span className="login-topbar__dot" aria-hidden="true" />
              {bar.chip}
            </span>
            <FitText className="login-topbar__text">{bar.text}</FitText>
            <nav className="login-topbar__links" aria-label={bar.linksLabel}>
              {bar.links.map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              ))}
            </nav>
          </>
        ) : (
          <span className="login-topbar__spacer" />
        )}
        <span className="login-topbar__controls">
          <ThemeSwitch placement="down" touchSize />
          <LanguageSwitch placement="down" reveal="end" touchSize />
        </span>
      </div>
    </motion.header>
  );
}

/**
 * What the demo's top bar drops on a phone (the sentence and the project
 * links), shown under the card instead, so a phone visitor loses nothing.
 * Rendered only on narrow screens (CSS); the top bar keeps them elsewhere.
 */
export function LoginStageFooter({ bar }: LoginTopBarProps): ReactElement | null {
  if (!bar) return null;
  return (
    <footer className="login-stage__footer">
      <p className="login-stage__footer-text">{bar.text}</p>
      <nav className="login-stage__footer-links" aria-label={bar.linksLabel}>
        {bar.links.map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}

/**
 * Login Top Bar
 *
 * The one header the login stage has in every mode (#4029). It is the same
 * header as openlinker.io: brand mark, then the language. The demo adds a
 * chip, one sentence saying where the visitor is, and links back to the
 * project. The sentence is shown only when all of it fits (`FitText`): a
 * cut-off sentence reads worse than none, so it is never ellipsised.
 *
 * @module features/auth/components/login-stage
 */
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { LanguageSwitch } from '../../../../shared/ui/language-switch';
import type { LoginStageCopy } from '../../lib/login-stage-copy';

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

export function LoginTopBar({ bar }: LoginTopBarProps): ReactElement {
  return (
    <header
      className={bar ? 'login-topbar login-topbar--demo' : 'login-topbar login-topbar--plain'}
    >
      <div className="login-topbar__inner">
        <span className="login-topbar__brand">
          <LoginBrandMark />
          OpenLinker
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
        <LanguageSwitch placement="down" />
      </div>
    </header>
  );
}

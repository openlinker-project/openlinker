/**
 * Login Page Preview
 *
 * The real production login stage, scaled down to fit the settings column,
 * inert, in the language being edited (#4029). It renders `LoginStage` - the
 * same component visitors see - so the preview cannot drift from the page.
 *
 * @module features/login-page-settings/components
 */
import { MotionConfig } from 'motion/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { buildProductionLoginCopy, LoginStage } from '../../auth';
import type { LoginPageCopyOverrides } from '../../system';
import { isMessagesLoaded, loadMessages, messagesIn } from '../../../shared/i18n';
import type { LoginPageLocale } from '../api/login-page-settings.types';

// Tall enough for the request-access card, the taller of the two screens.
const DESKTOP_FRAME = { width: 1180, height: 820 };
// The page's own layout follows the viewport, so on a phone the preview shows
// the phone layout and is framed like a phone.
const PHONE_FRAME = { width: 390, height: 920 };

const noopLogin = (): Promise<{ ok: true }> => Promise.resolve({ ok: true });

interface LoginPagePreviewProps {
  locale: LoginPageLocale;
  overrides: LoginPageCopyOverrides;
  canRegister: boolean;
  /** Which screen is shown; request access falls back to sign in when it is off. */
  screen: 'login' | 'register';
  /** `phone` for the narrow-screen modal; `desktop` beside the form. */
  frame?: 'desktop' | 'phone';
}

export function LoginPagePreview({
  locale,
  overrides,
  canRegister,
  screen,
  frame = 'desktop',
}: LoginPagePreviewProps): ReactElement {
  const size = frame === 'phone' ? PHONE_FRAME : DESKTOP_FRAME;
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [, setLoaded] = useState(() => isMessagesLoaded(locale));

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / size.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [size.width]);

  // The edited language may not be the interface's, so its catalog may not be loaded yet.
  useEffect(() => {
    if (isMessagesLoaded(locale)) return;
    let live = true;
    void loadMessages(locale).then(() => {
      if (live) setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [locale]);

  const messages = messagesIn('login', locale);
  const copy = buildProductionLoginCopy(messages, overrides);

  return (
    <div
      ref={boxRef}
      className="login-preview"
      style={{ height: size.height * scale }}
      aria-hidden="true"
      inert
    >
      <div
        className="login-preview__frame"
        style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
      >
        <MotionConfig reducedMotion="always">
          <LoginStage
            key={locale}
            className="login-stage--preview"
            animateEntrance={false}
            copy={copy}
            ui={messages.ui}
            canRegister={canRegister}
            tab={canRegister ? screen : 'login'}
            onTabChange={() => undefined}
            loginStep="form"
            onLogin={noopLogin}
            onRegister={noopLogin}
          />
        </MotionConfig>
      </div>
    </div>
  );
}

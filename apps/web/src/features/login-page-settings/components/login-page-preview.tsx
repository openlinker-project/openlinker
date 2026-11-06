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

const PREVIEW_W = 1180;
const PREVIEW_H = 700;

const noopLogin = (): Promise<{ ok: true }> => Promise.resolve({ ok: true });

interface LoginPagePreviewProps {
  locale: LoginPageLocale;
  overrides: LoginPageCopyOverrides;
  canRegister: boolean;
}

export function LoginPagePreview({
  locale,
  overrides,
  canRegister,
}: LoginPagePreviewProps): ReactElement {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [, setLoaded] = useState(() => isMessagesLoaded(locale));

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / PREVIEW_W);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
      style={{ height: PREVIEW_H * scale }}
      aria-hidden="true"
      inert
    >
      <div
        className="login-preview__frame"
        style={{ width: PREVIEW_W, height: PREVIEW_H, transform: `scale(${scale})` }}
      >
        <MotionConfig reducedMotion="always">
          <LoginStage
            key={locale}
            className="login-stage--preview"
            animateEntrance={false}
            copy={copy}
            ui={messages.ui}
            canRegister={canRegister}
            tab="login"
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

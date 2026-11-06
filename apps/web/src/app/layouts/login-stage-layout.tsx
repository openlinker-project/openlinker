/**
 * Login Stage Layout
 *
 * The container for the login, sign-up and session-recording consent screen
 * (#4029). `/login` and `/register` share this ONE layout route, so switching
 * tabs changes the URL without remounting the card: the card animates in
 * place and the page height never moves. `/consent` renders the same screen
 * with the consent step already active (`ConsentLayout` keeps its own guard).
 *
 * It owns the session and the mutations; `LoginStage` stays presentational.
 * After a successful sign-in the card shows a short "signed in" step before
 * it navigates, so the hand-off reads as one motion rather than a cut.
 *
 * @module app/layouts
 */
import { MotionConfig, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  buildDemoLoginCopy,
  buildProductionLoginCopy,
  LoginStage,
  useLogin,
  useUpdateAnalyticsConsentMutation,
  type AuthLoginStep,
  type AuthTab,
  type LoginOutcome,
  type RegisterOutcome,
} from '../../features/auth';
import { captureMarketingLanding, isMarketingLandingTrackable } from '../../features/demo';
import { useSystemConfigQuery } from '../../features/system';
import { useRegisterMutation } from '../../features/users';
import { ApiError } from '../../shared/api/api-error';
import { BENCH_PATH, resolveSessionSurface } from '../../shared/auth/session-surface';
import { useSession } from '../../shared/auth/use-session';
import { useLocale, useMessages } from '../../shared/i18n';
import { resolveNextPath } from '../../shared/lib/resolve-next-path';
import { LoadingState } from '../../shared/ui/feedback-state';
import { LoginBackdrop } from './login-backdrop';

const MARKETING_CAPTURE_PATHS = ['/login', '/register'];
const SIGNED_IN_HOLD_MS = 1800;
const SIGNED_IN_HOLD_REDUCED_MS = 400;

interface LoginStageScreenProps {
  mode: 'guest' | 'consent';
}

export function LoginStageScreen({ mode }: LoginStageScreenProps): ReactElement {
  const { isReady, session, clearSession } = useSession();
  const systemConfigQuery = useSystemConfigQuery();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const messages = useMessages('login');
  const { locale } = useLocale();
  const reduce = useReducedMotion();
  const login = useLogin();
  const register = useRegisterMutation();
  const consent = useUpdateAnalyticsConsentMutation();

  /** True from a sign-in submitted HERE until the hand-off ends, so the guard does not bounce it. */
  const signingIn = useRef(false);
  const [loginStep, setLoginStep] = useState<AuthLoginStep>(
    mode === 'consent' ? 'consent' : 'form'
  );

  const config = systemConfigQuery.data;
  const demoMode = config?.demoMode ?? false;

  useEffect(() => {
    if (mode !== 'guest' || !systemConfigQuery.isSuccess) return;
    if (session.status === 'authenticated') return;
    if (!MARKETING_CAPTURE_PATHS.includes(location.pathname)) return;
    // Scoped to /login and /register: that is where the footnote discloses
    // it, and the token-bearing guest routes must never be sent to PostHog.
    captureMarketingLanding(systemConfigQuery.data);
  }, [
    mode,
    systemConfigQuery.isSuccess,
    systemConfigQuery.data,
    session.status,
    location.pathname,
  ]);

  const target =
    resolveSessionSurface(isReady, session) === 'bench-only'
      ? BENCH_PATH
      : resolveNextPath(searchParams.get('next'));

  // A sign-in from this screen lands here once the session refreshes.
  useEffect(() => {
    if (
      mode !== 'guest' ||
      !signingIn.current ||
      session.status !== 'authenticated' ||
      loginStep !== 'form'
    )
      return;
    // Recording is accepted at sign-up (#1938), so signing in is never a consent step. An
    // account created before recording existed is sent to /consent by the app layout.
    setLoginStep('in');
  }, [mode, session.status, loginStep]);

  useEffect(() => {
    if (loginStep !== 'in') return undefined;
    const id = setTimeout(
      () => void navigate(target, { replace: true }),
      reduce ? SIGNED_IN_HOLD_REDUCED_MS : SIGNED_IN_HOLD_MS
    );
    return () => clearTimeout(id);
  }, [loginStep, navigate, target, reduce]);

  const onLogin = useCallback(
    async (values: { username: string; password: string }): Promise<LoginOutcome> => {
      signingIn.current = true;
      try {
        await login.mutateAsync(values);
        return { ok: true };
      } catch (error) {
        signingIn.current = false;
        const copy = demoMode ? messages.demo.login : messages.production.login;
        const message =
          error instanceof ApiError && (error.isUnauthorized() || error.isForbidden())
            ? copy.failed
            : error instanceof Error
              ? error.message
              : copy.failed;
        return { ok: false, message };
      }
    },
    [login, demoMode, messages]
  );

  const onRegister = useCallback(
    async (values: {
      username: string;
      email: string;
      password: string;
    }): Promise<RegisterOutcome> => {
      try {
        // Session recording is a condition of the demo (#1938): creating the
        // account is the acceptance, disclosed under the submit button.
        await register.mutateAsync({ ...values, analyticsConsent: demoMode });
        return { ok: true };
      } catch (error) {
        if (error instanceof ApiError && error.isConflict()) return { ok: false, taken: true };
        return { ok: false, message: error instanceof Error ? error.message : undefined };
      }
    },
    [register, demoMode]
  );

  const onConsentAccept = useCallback(() => {
    void (async (): Promise<void> => {
      try {
        await consent.mutateAsync({ analyticsConsent: true });
        setLoginStep('in');
      } catch {
        // Shown in the card; the account stays on the consent step.
      }
    })();
  }, [consent]);

  const onConsentDecline = useCallback(() => {
    void (async (): Promise<void> => {
      signingIn.current = false;
      await clearSession();
      if (mode === 'consent') {
        void navigate('/login', { replace: true });
      } else {
        setLoginStep('form');
      }
    })();
  }, [clearSession, mode, navigate]);

  const onTabChange = useCallback(
    (tab: AuthTab) => {
      void navigate({
        pathname: tab === 'register' ? '/register' : '/login',
        search: location.search,
      });
    },
    [navigate, location.search]
  );

  if (!isReady || systemConfigQuery.isLoading) {
    return (
      <div className="guest-layout">
        <LoadingState title={messages.ui.loading} message={messages.ui.loading} />
      </div>
    );
  }

  if (
    mode === 'guest' &&
    session.status === 'authenticated' &&
    !signingIn.current &&
    loginStep === 'form'
  ) {
    return <Navigate to={target} replace />;
  }

  // Consent is a demo-only step, so /consent always speaks the demo's copy.
  const copy =
    demoMode || mode === 'consent'
      ? buildDemoLoginCopy(messages, locale)
      : buildProductionLoginCopy(messages, config?.loginPage?.[locale]);
  const tab: AuthTab =
    mode === 'consent' || location.pathname !== '/register' ? 'login' : 'register';

  return (
    <MotionConfig reducedMotion="user">
      <LoginStage
        copy={copy}
        ui={messages.ui}
        background={demoMode ? <LoginBackdrop /> : undefined}
        canRegister={config?.registrationEnabled ?? false}
        tab={tab}
        onTabChange={onTabChange}
        loginStep={loginStep}
        tabsLocked={loginStep !== 'form'}
        showTrackingFootnote={
          mode === 'guest' && isMarketingLandingTrackable(config, location.search)
        }
        onLogin={onLogin}
        onRegister={onRegister}
        onConsentAccept={onConsentAccept}
        onConsentDecline={onConsentDecline}
        consentPending={consent.isPending}
        consentError={consent.error?.message ?? null}
      />
    </MotionConfig>
  );
}

/** The layout route `/login` and `/register` share. */
export function LoginStageLayout(): ReactElement {
  return <LoginStageScreen mode="guest" />;
}

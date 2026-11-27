/**
 * Auth Card
 *
 * The login stage's card (#4029): tabs, then a stack of views (register,
 * register sent, sign in, session-recording consent, signed in). Every view
 * stays mounted in the same stack; the stack animates to the ACTIVE view's
 * height so the card shrinks for sign-in, and it reports the TALLEST view so
 * the column can reserve it. Switching tabs, showing a validation error or a
 * failed sign-in therefore never changes the page height.
 *
 * Presentational: the container owns the session and the mutations and is
 * told the outcome through the async callbacks, so the same card renders
 * inert in the admin preview.
 *
 * @module features/auth/components/login-stage
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { Link } from 'react-router-dom';
import type { Messages, ResolvedCopy } from '../../../../shared/i18n';
import { Alert } from '../../../../shared/ui/alert';
import { Button } from '../../../../shared/ui/button';
import { Input } from '../../../../shared/ui/input';
import type { LoginStageCopy } from '../../lib/login-stage-copy';
import {
  loginStageSchema,
  registerStageSchema,
  type AuthErrorKey,
  type AuthStageFormSubmission,
  type AuthStageFormValues,
} from './auth-card.schema';
import { AuthField, type AuthFieldControlProps } from './auth-field';
import { LOGIN_STAGE_EASE, LOGIN_STAGE_SPRING } from './login-stage-motion';
import { handleLoginFormTab } from './login-focus-order';
import { PasswordInput } from './password-input';
import { RecordingPopover } from './recording-popover';
import { StackView, SuccessCheck } from './stack-view';

export type AuthTab = 'register' | 'login';
export type AuthLoginStep = 'form' | 'consent' | 'in';
export type LoginUi = ResolvedCopy<Messages['login']>['ui'];

export type RegisterOutcome = { ok: true } | { ok: false; taken?: boolean; message?: string };
export type LoginOutcome = { ok: true } | { ok: false; message: string };

export interface AuthCardProps {
  copy: LoginStageCopy;
  ui: LoginUi;
  /** Offer the register tab at all (sign-up in the demo, a request for access elsewhere). */
  canRegister: boolean;
  tab: AuthTab;
  onTabChange: (tab: AuthTab) => void;
  loginStep: AuthLoginStep;
  /** Tabs are shown but cannot be used (the consent step of a signed-in visitor). */
  tabsLocked?: boolean;
  showTrackingFootnote?: boolean;
  onLogin: (values: { username: string; password: string }) => Promise<LoginOutcome>;
  onRegister: (values: {
    username: string;
    email: string;
    password: string;
  }) => Promise<RegisterOutcome>;
  onConsentAccept?: () => void;
  onConsentDecline?: () => void;
  consentPending?: boolean;
  consentError?: string | null;
  /** The column height that keeps the page still: card chrome + the tallest view. */
  onReserve?: (height: number) => void;
}

const VIEW_KEYS = [
  'register:form',
  'register:sent',
  'login:form',
  'login:consent',
  'login:in',
] as const;
type ViewKey = (typeof VIEW_KEYS)[number];

const EMPTY: AuthStageFormValues = { username: '', email: '', password: '', confirm: '' };

export function AuthCard({
  copy,
  ui,
  canRegister,
  tab: requestedTab,
  onTabChange,
  loginStep,
  tabsLocked = false,
  showTrackingFootnote = false,
  onLogin,
  onRegister,
  onConsentAccept,
  onConsentDecline,
  consentPending = false,
  consentError = null,
  onReserve,
}: AuthCardProps): ReactElement {
  const reduce = useReducedMotion();
  const tab: AuthTab = canRegister ? requestedTab : 'login';
  const [registerStep, setRegisterStep] = useState<'form' | 'sent'>('form');
  const [loginFailed, setLoginFailed] = useState<string | null>(null);
  const [registerFailed, setRegisterFailed] = useState<string | null>(null);
  const modeRef = useRef<AuthTab>(tab);
  modeRef.current = tab;

  const resolver = useCallback<Resolver<AuthStageFormValues, unknown, AuthStageFormSubmission>>(
    (values, context, options) =>
      modeRef.current === 'login'
        ? zodResolver(loginStageSchema)(values, context, options)
        : zodResolver(registerStageSchema)(values, context, options),
    []
  );
  const form = useForm<AuthStageFormValues, unknown, AuthStageFormSubmission>({
    defaultValues: EMPTY,
    resolver,
    reValidateMode: 'onSubmit',
  });
  const { errors, isSubmitting } = form.formState;

  const ids = { u: useId(), e: useId(), p: useId(), c: useId(), lu: useId(), lp: useId() };
  const errorText = (field: keyof AuthStageFormValues): string | undefined => {
    const key = errors[field]?.message as AuthErrorKey | undefined;
    return key ? ui.v[key] ?? key : undefined;
  };

  // A tab the visitor picks hands focus to its form's first field, so they can
  // type at once, and scrolls it into view if it is not (a phone, where the
  // card sits below the hero); arrow keys on the tabs keep focus on the tabs.
  const focusFormAfterSwitch = useRef(false);
  const go = (next: AuthTab, focusForm = true): void => {
    focusFormAfterSwitch.current = focusForm;
    form.clearErrors();
    setLoginFailed(null);
    setRegisterFailed(null);
    onTabChange(next);
  };

  const onFieldChange = (field: keyof AuthStageFormValues): void => {
    if (errors[field]) form.clearErrors(field);
    if (loginFailed) setLoginFailed(null);
  };

  const submitLogin = (event: FormEvent): void => {
    modeRef.current = 'login';
    void form.handleSubmit(async (values) => {
      setLoginFailed(null);
      const outcome = await onLogin({
        username: values.username.trim(),
        password: values.password,
      });
      if (!outcome.ok) setLoginFailed(outcome.message);
    })(event);
  };

  const submitRegister = (event: FormEvent): void => {
    modeRef.current = 'register';
    void form.handleSubmit(async (values) => {
      setRegisterFailed(null);
      const outcome = await onRegister({
        username: values.username.trim(),
        email: values.email.trim(),
        password: values.password,
      });
      if (outcome.ok) {
        setRegisterStep('sent');
      } else if (outcome.taken) {
        form.setError('username', { message: 'taken' });
        form.setError('email', { message: 'taken' });
      } else {
        setRegisterFailed(outcome.message ?? ui.registerFailedTitle);
      }
    })(event);
  };

  const active: ViewKey = tab === 'register' ? `register:${registerStep}` : `login:${loginStep}`;

  const viewRefs = useRef<Partial<Record<ViewKey, HTMLDivElement | null>>>({});
  const stackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<Partial<Record<ViewKey, number>>>({});
  useLayoutEffect(() => {
    const measure = (): void => {
      const next: Partial<Record<ViewKey, number>> = {};
      for (const key of VIEW_KEYS) {
        const el = viewRefs.current[key];
        if (el) next[key] = el.offsetHeight;
      }
      setHeights((prev) => (VIEW_KEYS.every((k) => prev[k] === next[k]) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    for (const key of VIEW_KEYS) {
      const el = viewRefs.current[key];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [canRegister]);
  const tallest = Math.max(0, ...Object.values(heights).map((h) => h ?? 0));
  useLayoutEffect(() => {
    const card = rootRef.current?.parentElement;
    if (!card || !stackRef.current || !tallest || !onReserve) return;
    onReserve(card.offsetHeight - stackRef.current.offsetHeight + tallest);
  }, [tallest, showTrackingFootnote, onReserve]);
  const bindView = (key: ViewKey) => (el: HTMLDivElement | null) => {
    viewRefs.current[key] = el;
  };
  useEffect(() => {
    if (!focusFormAfterSwitch.current) return;
    focusFormAfterSwitch.current = false;
    const field = viewRefs.current[active]?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea'
    );
    if (!field) return;
    field.focus({ preventScroll: true });
    // `nearest` scrolls only when the field is out of view; `scroll-margin`
    // keeps it clear of the sticky top bar.
    field.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [active, reduce]);
  const tabRefs = useRef<Partial<Record<AuthTab, HTMLButtonElement | null>>>({});
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (tabsLocked || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const next: AuthTab = tab === 'register' ? 'login' : 'register';
    go(next, false);
    tabRefs.current[next]?.focus();
  };

  const pending = isSubmitting;
  const submitLabel = (idle: string, busy: string): ReactNode =>
    pending ? (
      <>
        <span className="auth-card__spinner" aria-hidden="true" />
        {busy}
      </>
    ) : (
      idle
    );
  const tap = reduce ? undefined : { scale: 0.985 };
  const pwLabels = { show: ui.show, hide: ui.hide, showPw: ui.showPw, hidePw: ui.hidePw };
  const values = form.watch();
  const control = form.control;

  const textInput = (
    field: 'username' | 'email',
    props: { autoComplete: string; type?: string },
    fieldProps: AuthFieldControlProps
  ): ReactElement => (
    <Controller
      name={field}
      control={control}
      render={({ field: f }) => (
        <Input
          {...props}
          {...fieldProps}
          ref={f.ref}
          name={f.name}
          value={f.value}
          onBlur={f.onBlur}
          onChange={(event) => {
            f.onChange(event.target.value);
            onFieldChange(field);
          }}
        />
      )}
    />
  );
  const passwordInput = (
    field: 'password' | 'confirm',
    autoComplete: string,
    fieldProps: AuthFieldControlProps
  ): ReactElement => (
    <Controller
      name={field}
      control={control}
      render={({ field: f }) => (
        <PasswordInput
          {...fieldProps}
          labels={pwLabels}
          autoComplete={autoComplete}
          ref={f.ref}
          name={f.name}
          value={f.value}
          onBlur={f.onBlur}
          onChange={(event) => {
            f.onChange(event.target.value);
            onFieldChange(field);
          }}
        />
      )}
    />
  );
  return (
    <div className="auth-card__inner" ref={rootRef}>
      {canRegister ? (
        <div
          className="auth-card__tabs"
          role="tablist"
          aria-label={ui.tabsLabel}
          onKeyDown={onTabsKeyDown}
        >
          {(['register', 'login'] as const).map((key) => (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              role="tab"
              type="button"
              className="auth-card__tab"
              aria-selected={tab === key}
              aria-disabled={tabsLocked || undefined}
              tabIndex={tabsLocked || tab !== key ? -1 : 0}
              onClick={() => {
                if (!tabsLocked && key !== tab) go(key);
              }}
            >
              {tab === key ? (
                <motion.span
                  layoutId="auth-card-tab-pill"
                  className="auth-card__tab-pill"
                  transition={LOGIN_STAGE_SPRING}
                />
              ) : null}
              <span>{copy.tabs[key]}</span>
            </button>
          ))}
        </div>
      ) : null}

      <motion.div
        className="auth-card__stack"
        ref={stackRef}
        initial={false}
        animate={{ height: heights[active] ?? 'auto' }}
        transition={{ type: 'spring', bounce: 0, visualDuration: 0.4 }}
      >
        {canRegister ? (
          <>
            <StackView
              name="register-form"
              active={active === 'register:form'}
              nodeRef={bindView('register:form')}
            >
              <div className="auth-card__head">
                <h2 className="auth-card__title">{copy.register.title}</h2>
                <p className="auth-card__lead">{copy.register.lead}</p>
              </div>
              <form className="auth-card__form" onSubmit={submitRegister} noValidate>
                <AuthField
                  id={ids.u}
                  label={ui.username}
                  error={tab === 'register' ? errorText('username') : undefined}
                >
                  {(fp) => textInput('username', { autoComplete: 'username' }, fp)}
                </AuthField>
                <AuthField
                  id={ids.e}
                  label={ui.email}
                  error={tab === 'register' ? errorText('email') : undefined}
                >
                  {(fp) => textInput('email', { autoComplete: 'email', type: 'email' }, fp)}
                </AuthField>
                <AuthField
                  id={ids.p}
                  label={ui.password}
                  aside={<span className="auth-field__hint">{ui.min8}</span>}
                  error={tab === 'register' ? errorText('password') : undefined}
                >
                  {(fp) => passwordInput('password', 'new-password', fp)}
                </AuthField>
                <AuthField
                  id={ids.c}
                  label={ui.confirm}
                  error={tab === 'register' ? errorText('confirm') : undefined}
                >
                  {(fp) => passwordInput('confirm', 'new-password', fp)}
                </AuthField>
                <motion.div whileTap={tap} transition={LOGIN_STAGE_SPRING} tabIndex={-1}>
                  <Button type="submit" className="auth-card__submit" disabled={pending}>
                    {submitLabel(copy.register.submit, copy.register.pending)}
                  </Button>
                </motion.div>
              </form>
              <FailureAlert title={ui.registerFailedTitle} message={registerFailed} collapsed />
              {copy.register.recording && copy.recorded ? (
                <p className="auth-card__note">
                  {copy.register.recording}{' '}
                  <RecordingPopover label={copy.recorded.label} items={copy.recorded.items} />
                </p>
              ) : null}
            </StackView>

            <StackView
              name="register-sent"
              centered
              active={active === 'register:sent'}
              nodeRef={bindView('register:sent')}
            >
              <SuccessCheck active={active === 'register:sent'} />
              <h2 className="auth-card__title">{copy.register.sentTitle}</h2>
              <p className="auth-card__lead">{copy.register.sentLead(values.email ?? '')}</p>
              <div className="auth-card__actions">
                <Button
                  tone="secondary"
                  onClick={() => {
                    setRegisterStep('form');
                    go('login');
                  }}
                >
                  {copy.register.sentAction}
                </Button>
              </div>
            </StackView>
          </>
        ) : null}

        <StackView
          name="login-form"
          active={active === 'login:form'}
          nodeRef={bindView('login:form')}
        >
          <div className="auth-card__head">
            <h2 className="auth-card__title">{copy.login.title}</h2>
            <p className="auth-card__lead">{copy.login.lead}</p>
          </div>
          <form
            className="auth-card__form"
            onSubmit={submitLogin}
            onKeyDown={handleLoginFormTab}
            noValidate
          >
            <AuthField
              id={ids.lu}
              label={ui.usernameOrEmail}
              error={tab === 'login' ? errorText('username') : undefined}
            >
              {(fp) => textInput('username', { autoComplete: 'username' }, fp)}
            </AuthField>
            <AuthField
              id={ids.lp}
              label={ui.password}
              aside={<Link to="/forgot-password">{ui.forgot}</Link>}
              error={tab === 'login' ? errorText('password') : undefined}
            >
              {(fp) => passwordInput('password', 'current-password', fp)}
            </AuthField>
            <motion.div whileTap={tap} transition={LOGIN_STAGE_SPRING} tabIndex={-1}>
              <Button type="submit" className="auth-card__submit" disabled={pending}>
                {submitLabel(copy.login.submit, copy.login.pending)}
              </Button>
            </motion.div>
          </form>
          <FailureAlert title={ui.loginFailedTitle} message={loginFailed} />
          {copy.support ? (
            <div className="auth-card__fine auth-card__support">{copy.support}</div>
          ) : null}
        </StackView>

        {copy.consent && copy.recorded ? (
          <StackView
            name="login-consent"
            active={active === 'login:consent'}
            nodeRef={bindView('login:consent')}
          >
            <h2 className="auth-card__title">{copy.consent.title}</h2>
            <p className="auth-card__lead auth-card__lead--spaced">{copy.consent.lead}</p>
            <ul className="auth-card__bullets">
              {copy.recorded.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {consentError ? (
              <div className="auth-card__consent-error">
                <Alert tone="error" title={copy.consent.errorTitle}>
                  {consentError}
                </Alert>
              </div>
            ) : null}
            <div className="auth-card__actions">
              <Button tone="ghost" onClick={onConsentDecline} disabled={consentPending}>
                {copy.consent.decline}
              </Button>
              <Button onClick={onConsentAccept} disabled={consentPending}>
                {consentPending ? copy.consent.pending : copy.consent.accept}
              </Button>
            </div>
            <p className="auth-card__fine">{copy.consent.fine}</p>
          </StackView>
        ) : null}

        <StackView
          name="login-in"
          centered
          active={active === 'login:in'}
          nodeRef={bindView('login:in')}
        >
          <SuccessCheck active={active === 'login:in'} />
          <h2 className="auth-card__title">{ui.signedInTitle}</h2>
          <p className="auth-card__lead">{ui.signedInLead}</p>
          <div className="auth-card__redirect" aria-hidden="true">
            <motion.span
              initial={false}
              animate={{ scaleX: active === 'login:in' ? 1 : 0 }}
              transition={{ duration: active === 'login:in' ? 1.8 : 0, ease: [0.4, 0, 0.2, 1] }}
            />
          </div>
        </StackView>
      </motion.div>

      {showTrackingFootnote ? <p className="auth-card__fine">{ui.tracking}</p> : null}
    </div>
  );
}

/**
 * Sign-in keeps a 16px slot under the form even when empty (the card's height for that view);
 * sign-up has no such slot, so its empty slot collapses.
 */
function FailureAlert({
  title,
  message,
  collapsed = false,
}: {
  title: string;
  message: string | null;
  collapsed?: boolean;
}): ReactElement {
  return (
    <div
      className={
        collapsed
          ? 'auth-card__alert-slot auth-card__alert-slot--collapsed'
          : 'auth-card__alert-slot'
      }
    >
      <AnimatePresence initial={false}>
        {message ? (
          <motion.div
            key="failure"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: LOGIN_STAGE_EASE }}
          >
            <Alert tone="error" title={title}>
              {message}
            </Alert>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

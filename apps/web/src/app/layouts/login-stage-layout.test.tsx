/**
 * Login Stage Layout tests (#4029)
 *
 * The auth card's behaviour through the real container: tabs keep what was
 * typed, errors and a failed sign-in land in place, sign-up shows the sent
 * step, production copy takes the admin's overrides, and the marketing UTM
 * capture (moved here from GuestLayout) still fires only where it should.
 *
 * @module app/layouts
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api/api-error';
import type { SystemConfig } from '../../features/system';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import { LoginStageLayout } from './login-stage-layout';

const DEMO_CONFIG: SystemConfig = { demoMode: true, registrationEnabled: true };

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderStage(
  config: SystemConfig,
  options: {
    route?: string;
    apiClient?: ReturnType<typeof createMockApiClient>;
    authenticated?: boolean;
  } = {}
): ReturnType<typeof createMockApiClient> {
  const apiClient =
    options.apiClient ??
    createMockApiClient({ system: { getConfig: vi.fn().mockResolvedValue(config) } });
  renderWithProviders(
    <>
      <Routes>
        <Route element={<LoginStageLayout />}>
          <Route path="/login" />
          <Route path="/register" />
        </Route>
        <Route path="/" element={<p>Dashboard page</p>} />
      </Routes>
      <LocationProbe />
    </>,
    {
      route: options.route ?? '/login',
      apiClient,
      sessionAdapter: options.authenticated ? createAuthenticatedSessionAdapter() : undefined,
    }
  );
  return apiClient;
}

const visibleView = (name: string): HTMLElement => {
  const view = document.querySelector<HTMLElement>(`[data-view="${name}"]`);
  if (!view) throw new Error(`view ${name} not rendered`);
  return view;
};

describe('LoginStageLayout', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('should open the register tab on /register and the sign-in tab on /login', async () => {
    renderStage(DEMO_CONFIG, { route: '/register' });
    expect(await screen.findByRole('tab', { name: 'Create account' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(visibleView('register-form')).toHaveAttribute('aria-hidden', 'false');
    expect(visibleView('login-form')).toHaveAttribute('aria-hidden', 'true');
  });

  it('should keep the typed username when switching tabs', async () => {
    renderStage(DEMO_CONFIG, { route: '/register' });
    const username = await screen.findByLabelText('Username');
    fireEvent.change(username, { target: { value: 'kasia' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Sign in' }));
    expect(await screen.findByRole('tab', { name: 'Sign in' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByLabelText('Username or email')).toHaveValue('kasia');
  });

  it('should show field errors in place when sign-in is submitted empty', async () => {
    renderStage(DEMO_CONFIG);
    await screen.findByRole('heading', { name: 'Sign in to the demo' });
    fireEvent.submit(visibleView('login-form').querySelector('form') as HTMLFormElement);
    expect(await screen.findByText('Enter your username or email.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
  });

  it('should explain a failed sign-in without moving to another view', async () => {
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(DEMO_CONFIG) },
      auth: { login: vi.fn().mockRejectedValue(new ApiError('Unauthorized', 401, null)) },
    });
    renderStage(DEMO_CONFIG, { apiClient });
    fireEvent.change(await screen.findByLabelText('Username or email'), {
      target: { value: 'kasia' },
    });
    fireEvent.change(screen.getAllByLabelText('Password')[1], {
      target: { value: 'wrong-pass' },
    });
    fireEvent.submit(visibleView('login-form').querySelector('form') as HTMLFormElement);
    expect(
      await screen.findByText(
        'Wrong username or password. Make sure your account has been activated.'
      )
    ).toBeInTheDocument();
    expect(visibleView('login-form')).toHaveAttribute('aria-hidden', 'false');
  });

  it('should show the sent step with the address after a successful sign-up', async () => {
    const apiClient = renderStage(DEMO_CONFIG, { route: '/register' });
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'kasia' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kasia@shop.pl' } });
    fireEvent.change(screen.getAllByLabelText('Password')[0], {
      target: { value: 'secret123' },
    });
    fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: 'secret123' } });
    fireEvent.submit(visibleView('register-form').querySelector('form') as HTMLFormElement);
    expect(await screen.findByText('kasia@shop.pl')).toBeInTheDocument();
    expect(visibleView('register-sent')).toHaveAttribute('aria-hidden', 'false');
    expect(apiClient.auth.register).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'kasia', email: 'kasia@shop.pl', analyticsConsent: true })
    );
  });

  it('should mark both fields when the username or email is taken', async () => {
    const apiClient = createMockApiClient({
      system: { getConfig: vi.fn().mockResolvedValue(DEMO_CONFIG) },
      auth: { register: vi.fn().mockRejectedValue(new ApiError('Conflict', 409, null)) },
    });
    renderStage(DEMO_CONFIG, { route: '/register', apiClient });
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'kasia' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kasia@shop.pl' } });
    fireEvent.change(screen.getAllByLabelText('Password')[0], {
      target: { value: 'secret123' },
    });
    fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: 'secret123' } });
    fireEvent.submit(visibleView('register-form').querySelector('form') as HTMLFormElement);
    expect(await screen.findAllByText('That username or email is already taken.')).toHaveLength(2);
  });

  it('should show no tabs and the admin copy on a real install with registration off', async () => {
    renderStage({
      demoMode: false,
      registrationEnabled: false,
      loginPage: { pl: {}, en: { headline: 'Acme panel', formTitle: '   ' } },
    });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('Acme panel OpenLinker');
  });

  it('should offer a request for access on a real install with registration on', async () => {
    renderStage({ demoMode: false, registrationEnabled: true });
    expect(await screen.findByRole('tab', { name: 'Request access' })).toBeInTheDocument();
  });

  it('should tab from the password to sign in, then Show, then the forgot link', async () => {
    renderStage(DEMO_CONFIG);
    await screen.findByRole('heading', { name: 'Sign in to the demo' });
    const form = visibleView('login-form');
    const tab = (shiftKey = false): void => {
      fireEvent.keyDown(document.activeElement as Element, { key: 'Tab', shiftKey });
    };
    const username = screen.getByLabelText('Username or email');
    username.focus();
    tab();
    expect(document.activeElement).toBe(
      form.querySelector('input[autocomplete="current-password"]')
    );
    tab();
    expect(document.activeElement).toBe(form.querySelector('button[type="submit"]'));
    tab();
    expect(document.activeElement).toBe(form.querySelector('.password-input__toggle'));
    tab();
    expect(document.activeElement).toHaveAttribute('href', '/forgot-password');
    tab(true);
    tab(true);
    expect(document.activeElement).toBe(form.querySelector('button[type="submit"]'));
    tab(true);
    expect(document.activeElement).toBe(
      form.querySelector('input[autocomplete="current-password"]')
    );
  });

  describe('?tab= link', () => {
    it('should open the sign-up tab from ?tab=sign-up on /login', async () => {
      renderStage(DEMO_CONFIG, { route: '/login?tab=sign-up' });
      expect(await screen.findByRole('tab', { name: 'Create account' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });

    it('should open the sign-in tab from ?tab=sign-in on /register', async () => {
      renderStage(DEMO_CONFIG, { route: '/register?tab=sign-in' });
      expect(await screen.findByRole('tab', { name: 'Sign in' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });

    it('should stay on sign-in when registration is off', async () => {
      renderStage({ demoMode: false, registrationEnabled: false }, { route: '/login?tab=sign-up' });
      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('should say registration is off in an info toast for ?tab=sign-up', async () => {
      renderStage({ demoMode: false, registrationEnabled: false }, { route: '/login?tab=sign-up' });
      const toast = await screen.findByTestId('registration-off-toast');
      expect(toast).toHaveTextContent('Registration is turned off');
      expect(toast).toHaveClass('toast--info');
    });

    it('should say registration is off in an info toast on /register', async () => {
      renderStage({ demoMode: false, registrationEnabled: false }, { route: '/register' });
      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      expect(await screen.findByTestId('registration-off-toast')).toBeInTheDocument();
    });

    it('should show no toast on /login or when registration is on', async () => {
      renderStage({ demoMode: false, registrationEnabled: false }, { route: '/login' });
      await screen.findByRole('heading', { name: 'Sign in' });
      expect(screen.queryByTestId('registration-off-toast')).not.toBeInTheDocument();
      cleanup();
      renderStage(DEMO_CONFIG, { route: '/register' });
      await screen.findByRole('tab', { name: 'Create account' });
      expect(screen.queryByTestId('registration-off-toast')).not.toBeInTheDocument();
    });

    it('should ignore an unknown value', async () => {
      renderStage(DEMO_CONFIG, { route: '/login?tab=constructor' });
      expect(await screen.findByRole('tab', { name: 'Sign in' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });

    it('should drop the parameter on a tab click and keep the rest', async () => {
      renderStage(DEMO_CONFIG, { route: '/login?tab=sign-up&next=%2Forders' });
      fireEvent.click(await screen.findByRole('tab', { name: 'Sign in' }));
      expect(await screen.findByRole('tab', { name: 'Sign in' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Forders');
    });
  });

  it('should redirect an already signed-in visitor', async () => {
    renderStage(DEMO_CONFIG, { authenticated: true });
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
  });

  describe('marketing UTM capture', () => {
    const posthogConfig: SystemConfig = {
      demoMode: true,
      registrationEnabled: true,
      demoIntegrations: {
        posthog: {
          key: 'phc_abc',
          host: 'https://eu.i.posthog.com',
          autocapture: true,
          sessionRecording: true,
          productEventsEnabled: false,
          enabledEventGroups: [],
        },
      },
    };

    it('should capture the landing when demo mode, posthog, and a utm param are all present', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      renderStage(posthogConfig, {
        route: '/login?utm_source=email&utm_campaign=demo_invite_2026_07',
      });
      await screen.findByRole('heading', { name: 'Sign in to the demo' });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe('https://eu.i.posthog.com/capture/');
    });

    it('should not capture when the URL carries no utm params', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      renderStage(posthogConfig, { route: '/login' });
      await screen.findByRole('heading', { name: 'Sign in to the demo' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should not capture when the session is already authenticated', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      renderStage(posthogConfig, {
        route: '/login?utm_source=email&utm_campaign=demo_invite_2026_07',
        authenticated: true,
      });
      await screen.findByText('Dashboard page');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

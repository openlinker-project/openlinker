/**
 * AI Provider Key Dialog — Regression Tests
 *
 * Regression guard against #478. The original bug: `useEffect` listed the
 * TanStack Query mutation wrapper (`mutation`) and the RHF form (`form`)
 * directly in its deps, while the body called `mutation.reset()`. Because
 * `useMutation()` returns a fresh wrapper identity on every render, the
 * effect re-fired each render → setState inside → render → loop, throwing
 * "Maximum update depth exceeded" the moment the dialog opened.
 *
 * Verified on the unfixed source before the patch was applied: all four
 * tests below failed with `Maximum update depth exceeded` and the same
 * `setRef → composeRefs` stack frame the production bug surfaced. Unlike
 * #461 (ThemeToggle, where vitest+jsdom did NOT reproduce the
 * ref-cleanup loop), this bug IS reproducible in jsdom — so these are
 * true negative-case regression tests. A future revert of the deps fix
 * will fail CI here.
 *
 * @module apps/web/src/features/ai-provider-settings/components
 */
import { StrictMode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/test-utils';
import { AiProviderKeyDialog } from './ai-provider-key-dialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(cleanup);

describe('AiProviderKeyDialog', () => {
  it('renders the Anthropic key dialog without throwing when provider is set', async () => {
    renderWithProviders(<AiProviderKeyDialog provider="anthropic" onClose={() => undefined} />);

    expect(await screen.findByText('Set Anthropic API key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save key/i })).toBeInTheDocument();
  });

  it('renders the OpenAI key dialog with the provider-specific placeholder', async () => {
    renderWithProviders(<AiProviderKeyDialog provider="openai" onClose={() => undefined} />);

    expect(await screen.findByText('Set OpenAI API key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument();
  });

  it('renders cleanly under StrictMode (matches main.tsx ancestry)', async () => {
    // Forward-guard mirroring `theme-toggle.test.tsx:138`. StrictMode in
    // React 19 double-invokes effects in dev, which is the most aggressive
    // jsdom can simulate the ref-cleanup churn that surfaces the bug in a
    // real browser. If this passes against broken code (likely — see file
    // header), the test is a smoke guard rather than a true regression
    // detector. The deps fix is verified by browser-level repro recorded
    // in the PR description.
    renderWithProviders(
      <StrictMode>
        <AiProviderKeyDialog provider="anthropic" onClose={() => undefined} />
      </StrictMode>,
    );

    expect(await screen.findByText('Set Anthropic API key')).toBeInTheDocument();
  });

  it('updates the title when re-rendered with a different provider', async () => {
    const { rerender } = renderWithProviders(
      <AiProviderKeyDialog provider="anthropic" onClose={() => undefined} />,
    );

    expect(await screen.findByText('Set Anthropic API key')).toBeInTheDocument();

    rerender(<AiProviderKeyDialog provider="openai" onClose={() => undefined} />);

    expect(await screen.findByText('Set OpenAI API key')).toBeInTheDocument();
  });
});

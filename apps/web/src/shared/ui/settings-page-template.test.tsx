/**
 * SettingsPageTemplate tests (#4132)
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPageTemplate, type SettingsPageSection } from './settings-page-template';

type IoCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let ioCallback: IoCallback | null = null;

beforeEach(() => {
  ioCallback = null;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IoCallback) {
        ioCallback = cb;
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sections: SettingsPageSection[] = [
  { id: 'a', label: 'Alpha', title: 'Alpha title', children: <input aria-label="field-a" /> },
  { id: 'b', label: 'Beta', title: 'Beta title', badge: true, children: <p>b body</p> },
];

function renderTemplate(
  extra: Partial<ComponentProps<typeof SettingsPageTemplate>> = {},
): ReturnType<typeof render> {
  return render(
    <SettingsPageTemplate
      eyebrow="Shop"
      title="Settings"
      short="Short"
      description="Desc"
      sections={sections}
      actions={<button type="button">Save</button>}
      {...extra}
    />,
  );
}

describe('SettingsPageTemplate', () => {
  it('should render sections, contents entries and actions', () => {
    renderTemplate();
    expect(screen.getByRole('heading', { name: /Alpha title/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('should highlight the first contents entry and render the New chip for a badge', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 900 } as DOMRect);
    renderTemplate();
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Beta' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('should move the highlight when a section passes the scroll line', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 900 } as DOMRect);
    renderTemplate();
    const beta = screen.getByRole('heading', { name: /Beta title/ }).closest('section') as HTMLElement;
    vi.spyOn(beta, 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect);
    act(() => {
      fireEvent.scroll(window);
    });
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-current', 'true');
  });

  it('should show the condensed title once the heading leaves the viewport', () => {
    const { container } = renderTemplate();
    const pane = container.querySelector('.settings-page__toc-page') as HTMLElement;
    expect(pane).toHaveAttribute('aria-hidden', 'true');
    expect(pane).toHaveAttribute('inert');
    act(() => ioCallback?.([{ isIntersecting: false }]));
    expect(pane).toHaveAttribute('aria-hidden', 'false');
    expect(pane).not.toHaveAttribute('inert');
  });

  it('should render only the sections it is given', () => {
    renderTemplate({ sections: [sections[0]] });
    expect(screen.queryByRole('heading', { name: /Beta title/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument();
  });

  it('should show the read-only status and disable fields when readOnly', () => {
    renderTemplate({ readOnly: true });
    expect(screen.getByRole('status')).toHaveTextContent(/read-only access/i);
    expect(screen.getByLabelText('field-a')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('should forward ref and merge className', () => {
    const ref = { current: null as HTMLDivElement | null };
    const { container } = renderTemplate({ ref, className: 'custom' });
    expect(ref.current).toBe(container.firstChild);
    expect(ref.current).toHaveClass('settings-page', 'custom');
  });

  it('should render the identity mark and keep the eyebrow out of the big header', () => {
    renderTemplate({ mark: <span data-testid="mark">AL</span> });
    expect(screen.getByTestId('mark')).toBeInTheDocument();
    const head = document.querySelector('.settings-page__head') as HTMLElement;
    expect(head).not.toHaveTextContent('Shop');
  });
});

import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PageLayout } from './page-layout';

function renderWithRouter(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('PageLayout', () => {
  afterEach(cleanup);

  it('renders title, eyebrow, and description without backTo or actions', () => {
    renderWithRouter(
      <PageLayout eyebrow="Orders" title="Order details" description="Single order view.">
        <p>body</p>
      </PageLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Order details' })).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Single order view.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders backTo as a BackLink inside the header content', () => {
    renderWithRouter(
      <PageLayout backTo={{ to: '/orders', label: 'Orders' }} title="Order #1">
        <p>body</p>
      </PageLayout>,
    );
    const link = screen.getByRole('link', { name: 'Orders' });
    expect(link).toHaveAttribute('href', '/orders');
    expect(link).toHaveClass('back-link');
  });

  it('renders backTo and actions as distinct regions', () => {
    const { container } = renderWithRouter(
      <PageLayout
        backTo={{ to: '/orders', label: 'Orders' }}
        title="Order #1"
        actions={<button type="button">Retry</button>}
      >
        <p>body</p>
      </PageLayout>,
    );

    const headerContent = container.querySelector('.page-header__content');
    const headerActions = container.querySelector('.page-header__actions');
    expect(headerContent).not.toBeNull();
    expect(headerActions).not.toBeNull();

    // BackLink sits in the content region, not the actions region.
    expect(within(headerContent as HTMLElement).getByRole('link', { name: 'Orders' })).toBeDefined();
    expect(within(headerActions as HTMLElement).getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(within(headerActions as HTMLElement).queryByRole('link', { name: 'Orders' })).toBeNull();
  });

  it('renders the three-line stack (backTo → eyebrow → title) in that document order', () => {
    const { container } = renderWithRouter(
      <PageLayout
        backTo={{ to: '/orders', label: 'Orders' }}
        eyebrow="Order"
        title="Order #1"
      >
        <p>body</p>
      </PageLayout>,
    );

    const headerContent = container.querySelector('.page-header__content');
    expect(headerContent).not.toBeNull();

    const children = Array.from((headerContent as HTMLElement).children);
    const backLinkIndex = children.findIndex((el) => el.classList.contains('back-link'));
    const eyebrowIndex = children.findIndex((el) => el.classList.contains('eyebrow'));
    const titleIndex = children.findIndex((el) => el.classList.contains('page-title'));

    expect(backLinkIndex).toBeGreaterThanOrEqual(0);
    expect(eyebrowIndex).toBeGreaterThan(backLinkIndex);
    expect(titleIndex).toBeGreaterThan(eyebrowIndex);
  });

  it('renders description below the title inside header content', () => {
    const { container } = renderWithRouter(
      <PageLayout title="Order #1" description="Single order view.">
        <p>body</p>
      </PageLayout>,
    );

    const headerContent = container.querySelector('.page-header__content');
    expect(headerContent).not.toBeNull();
    const description = (headerContent as HTMLElement).querySelector('.page-description');
    expect(description).not.toBeNull();
    expect(description).toHaveTextContent('Single order view.');
  });

  it('renders summary in a distinct region outside the header', () => {
    const { container } = renderWithRouter(
      <PageLayout title="Order #1" summary={<span data-testid="summary-chip">chip</span>}>
        <p>body</p>
      </PageLayout>,
    );

    const headerContent = container.querySelector('.page-header__content');
    const summary = container.querySelector('.page-summary');
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent('chip');
    // Summary sits outside the header content, not inside it.
    expect((headerContent as HTMLElement).contains(summary)).toBe(false);
  });
});

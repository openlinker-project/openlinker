/**
 * Product Events Section — Tests
 *
 * Covers: groups render from the real `DemoEventCatalog` (today's single
 * seed group), dimming when the section is `disabled`, checkbox round-trip
 * through the form, the read-only catalog listing each event's description,
 * and the empty-catalog fallback message (via a module-mocked empty
 * catalog, isolated to its own describe block so it doesn't affect the
 * real-catalog assertions above it).
 *
 * @module apps/web/src/features/posthog-settings/components
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { renderWithProviders } from '../../../test/test-utils';
import type { PosthogSettingsFormValues } from './posthog-settings-form.schema';
import { ProductEventsSection } from './product-events-section';

afterEach(cleanup);

function Harness({
  disabled,
  defaultEnabledEventGroups = [],
}: {
  disabled: boolean;
  defaultEnabledEventGroups?: string[];
}): ReactElement {
  const form = useForm<PosthogSettingsFormValues>({
    defaultValues: {
      enabled: true,
      region: 'eu',
      customHost: '',
      autocapture: false,
      sessionRecording: false,
      productEventsEnabled: true,
      enabledEventGroups: defaultEnabledEventGroups,
      apiKey: '',
    },
  });
  return <ProductEventsSection form={form} disabled={disabled} />;
}

describe('ProductEventsSection', () => {
  it('renders a toggle for each group derived from the catalog', () => {
    renderWithProviders(<Harness disabled={false} />);

    expect(screen.getByLabelText('conversion-intent')).toBeInTheDocument();
  });

  it('dims the event-groups panel when disabled', () => {
    renderWithProviders(<Harness disabled />);

    const groupCheckbox = screen.getByLabelText('conversion-intent');
    expect(groupCheckbox).toBeDisabled();
  });

  it('toggles a group on and off in the form', () => {
    renderWithProviders(<Harness disabled={false} />);

    const groupCheckbox = screen.getByLabelText('conversion-intent') as HTMLInputElement;
    expect(groupCheckbox.checked).toBe(false);

    fireEvent.click(groupCheckbox);
    expect(groupCheckbox.checked).toBe(true);

    fireEvent.click(groupCheckbox);
    expect(groupCheckbox.checked).toBe(false);
  });

  it('renders the read-only catalog with each event description', () => {
    renderWithProviders(<Harness disabled={false} />);

    expect(screen.getByText('demo_viewer_locked_action_clicked')).toBeInTheDocument();
    expect(screen.getByText(/intent-to-convert signal/)).toBeInTheDocument();
  });
});

describe('ProductEventsSection with an empty catalog', () => {
  afterEach(() => {
    vi.doUnmock('../../demo');
    vi.resetModules();
  });

  it('shows the empty-state message instead of a blank panel', async () => {
    vi.doMock('../../demo', () => ({ DemoEventCatalog: {} }));
    vi.resetModules();

    const { ProductEventsSection: ProductEventsSectionWithEmptyCatalog } = await import(
      './product-events-section'
    );

    function EmptyHarness(): ReactElement {
      const form = useForm<PosthogSettingsFormValues>({
        defaultValues: {
          enabled: true,
          region: 'eu',
          customHost: '',
          autocapture: false,
          sessionRecording: false,
          productEventsEnabled: true,
          enabledEventGroups: [],
          apiKey: '',
        },
      });
      return <ProductEventsSectionWithEmptyCatalog form={form} disabled={false} />;
    }

    renderWithProviders(<EmptyHarness />);

    expect(screen.getByText('No event groups are defined yet.')).toBeInTheDocument();
  });
});

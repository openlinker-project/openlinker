/**
 * AllegroSetupSummary tests
 *
 * Covers identity-row rendering, environment label (step 1+), and
 * catalog-linking section (step 2+) including the null-catalog fallback.
 * Summary is a pure component taking props, so no providers are needed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ALLEGRO_SETUP_DEFAULT_VALUES } from './allegro-setup.schema';
import { AllegroSetupSummary } from './allegro-setup-summary';

describe('AllegroSetupSummary', () => {
  afterEach(cleanup);

  it('renders em-dash placeholders for unset identity fields on step 0', () => {
    render(
      <AllegroSetupSummary
        values={ALLEGRO_SETUP_DEFAULT_VALUES}
        stepIndex={0}
        selectedCatalogName={null}
      />
    );
    // Two rows on step 0 (Name, Client ID) — both empty → two em-dashes.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('renders the environment label (Sandbox) from step 1 onwards', () => {
    render(
      <AllegroSetupSummary
        values={{ ...ALLEGRO_SETUP_DEFAULT_VALUES, environment: 'sandbox' }}
        stepIndex={1}
        selectedCatalogName={null}
      />
    );
    expect(screen.getByText('Sandbox')).toBeInTheDocument();
  });

  it('renders the linked catalog name from step 2 when provided', () => {
    render(
      <AllegroSetupSummary
        values={ALLEGRO_SETUP_DEFAULT_VALUES}
        stepIndex={2}
        selectedCatalogName="Main PrestaShop store"
      />
    );
    expect(screen.getByText('Main PrestaShop store')).toBeInTheDocument();
  });

  it('falls back to "— not linked —" when no catalog is selected on step 2', () => {
    render(
      <AllegroSetupSummary
        values={ALLEGRO_SETUP_DEFAULT_VALUES}
        stepIndex={2}
        selectedCatalogName={null}
      />
    );
    expect(screen.getByText('— not linked —')).toBeInTheDocument();
  });
});

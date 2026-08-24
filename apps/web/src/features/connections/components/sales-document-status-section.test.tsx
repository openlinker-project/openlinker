/**
 * SalesDocumentStatusSection Tests (#2159)
 *
 * This section is READ-ONLY by design (demoted from the editable
 * `InvoicingPrimarySection` checkbox) — these tests assert there is no
 * checkbox and no editable control, only a summary + a link.
 */
import { render, screen, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../api/connections.types';
import { SalesDocumentStatusSection } from './sales-document-status-section';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_1',
    name: 'inFakt',
    platformType: 'infakt',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: ['Invoicing'],
    supportedCapabilities: ['Invoicing'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderSection(
  connection: Connection,
  allConnections: Connection[] = [connection],
): RenderResult {
  return render(
    <MemoryRouter>
      <SalesDocumentStatusSection connection={connection} allConnections={allConnections} />
    </MemoryRouter>,
  );
}

describe('SalesDocumentStatusSection', () => {
  it('should render no checkbox — the write control is gone', () => {
    renderSection(makeConnection());

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('should show "Nothing" when config.salesDocument.documentKind is unset', () => {
    renderSection(makeConnection());

    expect(screen.getByText('Nothing')).toBeInTheDocument();
  });

  it('should show the resolved Issues label for a configured documentKind', () => {
    renderSection(
      makeConnection({ config: { salesDocument: { documentKind: 'invoice' } } }),
    );

    expect(screen.getByText('Invoice')).toBeInTheDocument();
  });

  it('should show Primary status when config.invoicing.isPrimary is true', () => {
    renderSection(makeConnection({ config: { invoicing: { isPrimary: true } } }));

    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('should show Not primary status and name the current primary sibling', () => {
    const thisConnection = makeConnection({ id: 'conn_eparagony', name: 'eparagony.pl' });
    const otherPrimary = makeConnection({
      id: 'conn_infakt',
      name: 'inFakt',
      config: { invoicing: { isPrimary: true } },
    });

    renderSection(thisConnection, [thisConnection, otherPrimary]);

    expect(screen.getByText('Not primary')).toBeInTheDocument();
    expect(screen.getByText(/inFakt is already primary\./)).toBeInTheDocument();
  });

  it('should link to the centralized Settings → Sales documents page', () => {
    renderSection(makeConnection());

    expect(screen.getByRole('link', { name: /Manage in Settings → Sales documents/i })).toHaveAttribute(
      'href',
      '/settings/sales-documents',
    );
  });
});

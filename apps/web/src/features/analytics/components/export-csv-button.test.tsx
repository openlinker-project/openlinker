import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { AnalyticsCsvExportRequest } from '../api/analytics-export.types';
import { ExportCsvButton } from './export-csv-button';

const REQUEST: AnalyticsCsvExportRequest = {
  report: 'margin-channel',
  filters: { from: '2026-08-01', to: '2026-08-31' },
};

describe('ExportCsvButton (#3590)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:csv');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should disable itself and say it is preparing while the file is being built', async () => {
    const exportCsv = vi.fn(() => new Promise<never>(() => {}));
    renderWithProviders(
      <ExportCsvButton testId="export-csv-margin-channel" reportLabel="Margin by channel" request={REQUEST} />,
      { apiClient: createMockApiClient({ analytics: { exportCsv } }) }
    );

    await userEvent.click(screen.getByTestId('export-csv-margin-channel'));

    const button = screen.getByTestId('export-csv-margin-channel');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Preparing CSV…');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('export-status')).toHaveTextContent('Preparing');
    expect(exportCsv).toHaveBeenCalledWith(REQUEST);
  });

  it('should save the file under the server name and confirm with a toast', async () => {
    const exportCsv = vi.fn().mockResolvedValue({
      blob: new Blob(['a,b'], { type: 'text/csv' }),
      filename: 'openlinker_margin-by-channel_2026-08-01_2026-08-31_PLN_net.csv',
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(
      <ExportCsvButton testId="export-csv-margin-channel" reportLabel="Margin by channel" request={REQUEST} />,
      { apiClient: createMockApiClient({ analytics: { exportCsv } }) }
    );

    await userEvent.click(screen.getByTestId('export-csv-margin-channel'));

    expect(await screen.findByText('CSV downloaded')).toBeInTheDocument();
    expect(screen.getByTestId('export-status')).toHaveTextContent('CSV downloaded');
    expect(
      screen.getByText('openlinker_margin-by-channel_2026-08-01_2026-08-31_PLN_net.csv')
    ).toBeInTheDocument();
    expect(click).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('export-csv-margin-channel')).toBeEnabled());
  });

  it('should show the server reason and offer Change range and Try again when refused', async () => {
    const message = 'One CSV covers at most 366 days. Narrow the range.';
    const exportCsv = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(message, 400, { code: 'EXPORT_RANGE_TOO_WIDE', message }))
      .mockResolvedValueOnce({ blob: new Blob(['x']), filename: 'ok.csv' });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(
      <ExportCsvButton testId="export-csv-margin-channel" reportLabel="Margin by channel" request={REQUEST} />,
      { apiClient: createMockApiClient({ analytics: { exportCsv } }) }
    );

    await userEvent.click(screen.getByTestId('export-csv-margin-channel'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(screen.getByTestId('export-change-range')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('export-retry'));

    expect(await screen.findByText('CSV downloaded')).toBeInTheDocument();
    expect(exportCsv).toHaveBeenCalledTimes(2);
  });

  it('should say the file is in the reporting currency when another display currency is on screen', () => {
    renderWithProviders(
      <ExportCsvButton
        testId="export-csv-sales-channel"
        reportLabel="Sales by channel"
        request={REQUEST}
        displayCurrency="EUR"
        reportingCurrency="PLN"
      />,
      { apiClient: createMockApiClient() }
    );

    expect(screen.getByTestId('export-csv-sales-channel')).toHaveAttribute(
      'title',
      'The file is in PLN, the reporting currency, not EUR.'
    );
  });
});

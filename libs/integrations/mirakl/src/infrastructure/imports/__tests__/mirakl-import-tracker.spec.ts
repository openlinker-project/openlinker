/**
 * Mirakl Import Tracker: unit tests
 *
 * Status bodies are the ones Empik staging returned during SPIKE-4268: offer
 * import 2156101 (clean) and 2156124 (one error line), a stock import, a price
 * import listed by PRI02, and product import 30532 stuck in `SENT`.
 *
 * @module libs/integrations/mirakl/src/infrastructure/imports
 */
import { MiraklConfigException } from '../../../domain/exceptions/mirakl-config.exception';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import { MiraklImportTracker } from '../mirakl-import-tracker';

function makeTracker(): { tracker: MiraklImportTracker; get: jest.Mock; getText: jest.Mock } {
  const get = jest.fn();
  const getText = jest.fn();
  const client = { get, getText } as unknown as IMiraklHttpClient;
  return { tracker: new MiraklImportTracker(client, 'conn-1'), get, getText };
}

describe('MiraklImportTracker', () => {
  describe('getStatus', () => {
    it('should report done with counts when an offer import completed cleanly', async () => {
      const { tracker, get } = makeTracker();
      get.mockResolvedValue({
        status: 200,
        data: {
          date_created: '2026-11-23T11:03:58Z',
          has_error_report: false,
          import_id: 2156101,
          lines_in_error: 0,
          lines_in_pending: 0,
          lines_in_success: 1,
          lines_read: 1,
          mode: 'NORMAL',
          status: 'COMPLETE',
          type: 'MIRAKL',
        },
      });

      await expect(tracker.getStatus('offers', '2156101')).resolves.toEqual({
        kind: 'offers',
        importId: '2156101',
        state: 'done',
        rawStatus: 'COMPLETE',
        hasErrorReport: false,
        linesInError: 0,
        linesInSuccess: 1,
        linesRead: 1,
      });
      expect(get).toHaveBeenCalledWith('/api/offers/imports/2156101');
    });

    it('should report done with error lines when an import completed with failures', async () => {
      const { tracker, get } = makeTracker();
      get.mockResolvedValue({
        status: 200,
        data: { status: 'COMPLETE', has_error_report: true, lines_in_error: 1, lines_in_success: 0, lines_read: 1 },
      });

      const status = await tracker.getStatus('offers', '2156124');

      expect(status.state).toBe('done');
      expect(status.linesInError).toBe(1);
      expect(status.hasErrorReport).toBe(true);
    });

    it('should read the stock status path when the import is a stock import', async () => {
      const { tracker, get } = makeTracker();
      get.mockResolvedValue({
        status: 200,
        data: { status: 'COMPLETE', has_error_report: false, lines_in_error: 0, lines_in_success: 1 },
      });

      const status = await tracker.getStatus('stock', '6c75dbb9-d8da-477d-b011-1a172b4ff295');

      expect(status.state).toBe('done');
      expect(get).toHaveBeenCalledWith(
        '/api/offers/stock/imports/6c75dbb9-d8da-477d-b011-1a172b4ff295/status',
      );
    });

    it('should read the first listed row when the import is a price import', async () => {
      const { tracker, get } = makeTracker();
      get.mockResolvedValue({
        status: 200,
        data: {
          data: [{ status: 'COMPLETE', has_error_report: false, lines_in_error: 0, lines_in_success: 1 }],
          next_page_token: null,
        },
      });

      const status = await tracker.getStatus('prices', '1b1ac3dd-42ab-4543-ab64-a4f42b650f9e');

      expect(status.state).toBe('done');
      expect(get).toHaveBeenCalledWith('/api/offers/pricing/imports', {
        queryParams: { import_id: '1b1ac3dd-42ab-4543-ab64-a4f42b650f9e' },
      });
    });

    it('should report pending when the price import is not listed yet', async () => {
      const { tracker, get } = makeTracker();
      get.mockResolvedValue({ status: 200, data: { data: [], next_page_token: null } });

      await expect(tracker.getStatus('prices', 'abc')).resolves.toMatchObject({
        state: 'pending',
        rawStatus: null,
      });
    });

    it('should report awaiting-operator when a product import was sent to the operator', async () => {
      const { tracker, get } = makeTracker();
      get.mockResolvedValue({
        status: 200,
        data: {
          has_error_report: false,
          import_id: 30532,
          import_status: 'SENT',
          transform_lines_in_error: 0,
          transform_lines_in_success: 1,
          transform_lines_read: 1,
        },
      });

      await expect(tracker.getStatus('products', '30532')).resolves.toEqual({
        kind: 'products',
        importId: '30532',
        state: 'awaiting-operator',
        rawStatus: 'SENT',
        hasErrorReport: false,
        linesInError: 0,
        linesInSuccess: 1,
        linesRead: 1,
      });
    });

    it('should report failed when Mirakl says the import failed', async () => {
      const { tracker, get } = makeTracker();
      get.mockResolvedValue({ status: 200, data: { status: 'FAILED', has_error_report: true } });

      await expect(tracker.getStatus('offers', '1')).resolves.toMatchObject({ state: 'failed' });
    });

    it('should report pending when Mirakl is still running the import', async () => {
      const { tracker, get } = makeTracker();
      get.mockResolvedValue({ status: 200, data: { status: 'RUNNING' } });

      await expect(tracker.getStatus('stock', 'abc')).resolves.toMatchObject({ state: 'pending' });
    });

    it('should report pending, never done, when the status is unrecognised', async () => {
      const { tracker, get } = makeTracker();
      get.mockResolvedValue({ status: 200, data: { status: 'SOMETHING_NEW' } });

      await expect(tracker.getStatus('offers', '1')).resolves.toMatchObject({
        state: 'pending',
        rawStatus: 'SOMETHING_NEW',
      });
    });

    it('should not treat SENT as awaiting-operator when the import is not a product import', async () => {
      const { tracker, get } = makeTracker();
      get.mockResolvedValue({ status: 200, data: { status: 'SENT' } });

      await expect(tracker.getStatus('offers', '1')).resolves.toMatchObject({ state: 'pending' });
    });

    it('should refuse an import id that could alter the path', async () => {
      const { tracker, get } = makeTracker();

      await expect(tracker.getStatus('offers', '../account')).rejects.toBeInstanceOf(
        MiraklConfigException,
      );
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('getErrorReport', () => {
    it('should read and parse the report from the kind error_report path', async () => {
      const { tracker, getText } = makeTracker();
      getText.mockResolvedValue({
        status: 200,
        data: "line-number;errors;offer-sku;quantity\n2;No existing offer with SKU 'X' found;X;3\n",
      });

      await expect(tracker.getErrorReport('stock', 'abc-1')).resolves.toEqual([
        { reason: "No existing offer with SKU 'X' found", line: 2, sku: 'X' },
      ]);
      expect(getText).toHaveBeenCalledWith('/api/offers/stock/imports/abc-1/error_report');
    });

    it.each([
      ['offers', '/api/offers/imports/7/error_report'],
      ['prices', '/api/offers/pricing/imports/7/error_report'],
      ['products', '/api/products/imports/7/error_report'],
    ] as const)('should read the %s error report path', async (kind, path) => {
      const { tracker, getText } = makeTracker();
      getText.mockResolvedValue({ status: 200, data: '' });

      await tracker.getErrorReport(kind, '7');

      expect(getText).toHaveBeenCalledWith(path);
    });
  });
});

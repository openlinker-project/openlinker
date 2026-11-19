/**
 * Amazon feed processing report tests (#4184)
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers/__tests__
 */
import { readAmazonFeedProcessingReport } from '../amazon-feed-processing-report';

describe('readAmazonFeedProcessingReport', () => {
  it('should read the counts and errors of a flat-file report', () => {
    const report = [
      'Feed Processing Summary:',
      '\tNumber of records processed\t\t2',
      '\tNumber of records successful\t\t1',
      '',
      'original-record-number\torder-id\terror-code\terror-type\terror-message',
      '2\t302-1\t18028\tError\tThe refund amount exceeds the amount paid.',
      '3\t302-1\t99\tWarning\tJust a note.',
    ].join('\n');

    expect(readAmazonFeedProcessingReport(report)).toEqual({
      processed: 2,
      successful: 1,
      errors: ['The refund amount exceeds the amount paid.'],
    });
  });

  it('should read a JSON report', () => {
    const report = JSON.stringify({
      summary: { messagesProcessed: 1, messagesAccepted: 0, errors: 1 },
      issues: [{ severity: 'ERROR', message: 'Invalid order-item-id' }],
    });

    expect(readAmazonFeedProcessingReport(report)).toEqual({ processed: 1, successful: 0, errors: ['Invalid order-item-id'] });
  });

  it('should report no counts for something it cannot read', () => {
    expect(readAmazonFeedProcessingReport('{broken')).toEqual({ processed: null, successful: null, errors: [] });
  });
});

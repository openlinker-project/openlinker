import { describe, expect, it } from 'vitest';
import { mapDocumentEmailsToEvents } from './document-email-timeline-events';

const base = {
  documentId: 'd1',
  failureReason: null,
  failureMessage: null,
  createdAt: '2026-10-28T10:00:00.000Z',
};

describe('mapDocumentEmailsToEvents', () => {
  it('should narrate a sent invoice with who sent it', () => {
    const [event] = mapDocumentEmailsToEvents([
      { ...base, id: '1', documentKind: 'invoice', sentVia: 'openlinker', outcome: 'sent' },
    ]);

    expect(event).toMatchObject({
      title: 'Invoice emailed to buyer',
      by: 'OpenLinker mailer',
      tone: 'success',
    });
  });

  it('should show the server message verbatim for a failure', () => {
    const [event] = mapDocumentEmailsToEvents([
      {
        ...base,
        id: '2',
        documentKind: 'fiscal-receipt',
        sentVia: null,
        outcome: 'failed',
        failureReason: 'no-document',
        failureMessage: 'There is no document to attach yet.',
      },
    ]);

    expect(event).toMatchObject({
      title: 'Email to buyer failed',
      description: 'There is no document to attach yet.',
      tone: 'error',
    });
  });
});

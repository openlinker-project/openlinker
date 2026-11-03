/**
 * Document email refusal -> HTTP (#3550)
 *
 * One mapping for the invoice and the receipt send routes, so a refusal means
 * the same status and `code` whichever document was sent. The body carries the
 * readable `message` (mockup M24 note 9: the dialog shows the server's own
 * words) AND the machine `code` a client branches on - never the other way
 * round, and never a raw provider or SMTP error.
 *
 * 404 absent document - 422 the document's state cannot be sent - 409 not
 * ready yet (try again) - 400 the recipient is the problem - 502 the send
 * itself failed - 503 this server cannot send email.
 *
 * @module apps/api/src/common/http
 */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OrderDocumentEmailRefusal, OrderDocumentEmailResult } from '@openlinker/core/orders';

type Refused = Extract<OrderDocumentEmailResult, { status: 'refused' }>;

const FACTORY: Record<OrderDocumentEmailRefusal, (body: object) => Error> = {
  'document-not-found': (b) => new NotFoundException(b),
  'not-issued': (b) => new UnprocessableEntityException(b),
  'document-not-ready': (b) => new ConflictException(b),
  'no-document': (b) => new UnprocessableEntityException(b),
  'no-recipient': (b) => new BadRequestException(b),
  'invalid-recipient': (b) => new BadRequestException(b),
  'mailer-unavailable': (b) => new ServiceUnavailableException(b),
  'send-failed': (b) => new BadGatewayException(b),
};

export function toDocumentEmailException(refused: Refused): Error {
  return FACTORY[refused.reason]({ message: refused.message, code: refused.reason });
}

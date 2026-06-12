/**
 * DPD InfoServices SOAP Client
 *
 * Native-`fetch` SOAP transport for DPD InfoServices `getEventsForWaybillV1`
 * (#965, ADR-022) — the tracking half of the dual-transport DPD plugin. Builds
 * the envelope by hand (one operation; no `soap` lib) and parses the reply with
 * `fast-xml-parser` (the PrestaShop-plugin precedent). Read-only + idempotent,
 * so every transient failure (network / `429` / `5xx` without a fault) is
 * retried with jittered backoff.
 *
 * Decoding guards (ADR-022 consequences):
 *  - `parseTagValue: false` — DPD `businessCode`s have leading zeros (`030103`)
 *    and waybills are digit strings; numeric coercion would corrupt them.
 *  - `isArray` for `eventsList` / `eventDataList` — `fast-xml-parser` collapses a
 *    single occurrence to an object, which would break list handling.
 *  - **SOAP `<Fault>` can arrive on HTTP 200 *or* 500** — the body is parsed and
 *    inspected for a fault before trusting the HTTP status.
 *  - The request body carries `login`/`password` (SOAP `authDataV1`), so it is
 *    **never logged** — only endpoint + waybill + status + latency.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/http
 */
import { randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { Logger } from '@openlinker/shared/logging';
import {
  DPD_EVENTS_SELECT_ALL,
  DPD_EVENT_LANGUAGE,
  type DpdWaybillEvent,
} from '../../domain/types/dpd-tracking.types';
import { DpdNetworkException } from '../../domain/exceptions/dpd-network.exception';
import { DpdUnauthorizedException } from '../../domain/exceptions/dpd-unauthorized.exception';
import { DpdTrackingException } from '../../domain/exceptions/dpd-tracking.exception';
import type { IDpdInfoSoapClient } from './dpd-info-soap-client.interface';

interface SoapAuth {
  login: string;
  password: string;
}

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  maxDelayMs: 8000,
};

const REQUEST_TIMEOUT_MS = 30_000;
const SOAP_NS = 'http://events.dpdinfoservices.dpd.com.pl/';

/** Internal marker for a retryable transient failure (network / 429 / 5xx-no-fault). */
class RetryableSoapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableSoapError';
  }
}

export class DpdInfoSoapClient implements IDpdInfoSoapClient {
  private readonly logger = new Logger(DpdInfoSoapClient.name);
  private readonly retryConfig: RetryConfig;
  private readonly parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === 'eventsList' || name === 'eventDataList',
  });

  constructor(
    private readonly endpoint: string,
    private readonly auth: SoapAuth,
    retryConfig?: Partial<RetryConfig>,
  ) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  async getEventsForWaybill(input: { waybill: string }): Promise<DpdWaybillEvent[]> {
    const requestId = randomUUID();
    const envelope = buildEnvelope(input.waybill, this.auth);
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const parsed = await this.fetchOnce(envelope, input.waybill);
        return this.parseEvents(parsed);
      } catch (error) {
        if (!(error instanceof RetryableSoapError)) {
          throw error; // auth / fault / parse failures are terminal
        }
        if (attempt === this.retryConfig.maxRetries) {
          throw new DpdNetworkException(error.message, error);
        }
        const waitMs = this.jitter(delay);
        this.logger.warn(
          `DPD InfoServices getEventsForWaybill failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}); retrying in ${waitMs}ms [requestId=${requestId}]`,
        );
        await this.sleep(waitMs);
        delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
      }
    }
    // Unreachable: the final attempt returns or throws above.
    throw new DpdNetworkException('DPD InfoServices request exhausted its retry budget');
  }

  /**
   * One round-trip → the parsed SOAP body. Parses exactly once and routes:
   * SOAP `<Fault>` (on HTTP 200 *or* 5xx) → auth/tracking exception; non-ok
   * status → retryable/unauthorized/tracking. Never logs the body.
   */
  private async fetchOnce(envelope: string, waybill: string): Promise<SoapParsed> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
        body: envelope,
        signal: controller.signal,
      });
    } catch (error) {
      // Network/timeout — retryable for this read-only call.
      throw new RetryableSoapError(`DPD InfoServices network error: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let parsed: SoapParsed | null = null;
    try {
      parsed = this.parser.parse(text) as SoapParsed;
    } catch {
      parsed = null; // resolved below: non-ok → status path; ok → unparseable
    }

    // A SOAP fault can arrive on HTTP 200 OR 5xx — inspect the parsed body first.
    const fault = parsed?.Envelope?.Body?.Fault;
    if (fault) {
      const faultstring = fault.faultstring ?? 'unknown SOAP fault';
      if (/denied|authoriz|authentic/i.test(faultstring)) {
        throw new DpdUnauthorizedException(
          `DPD InfoServices auth failed for waybill ${waybill}: ${faultstring}`,
        );
      }
      throw new DpdTrackingException(`DPD InfoServices fault for waybill ${waybill}: ${faultstring}`);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new DpdUnauthorizedException(`DPD InfoServices returned ${response.status} for waybill ${waybill}`);
      }
      if (response.status === 429 || response.status >= 500) {
        throw new RetryableSoapError(`DPD InfoServices returned ${response.status}`);
      }
      throw new DpdTrackingException(`DPD InfoServices returned ${response.status} for waybill ${waybill}`);
    }
    if (!parsed) {
      throw new DpdTrackingException('DPD InfoServices returned an unparseable response body');
    }
    return parsed;
  }

  private parseEvents(parsed: SoapParsed): DpdWaybillEvent[] {
    const ret = parsed?.Envelope?.Body?.getEventsForWaybillV1Response?.return;
    if (!ret) {
      throw new DpdTrackingException('DPD InfoServices response missing getEventsForWaybillV1Response/return');
    }
    const rows = ret.eventsList ?? [];
    return rows
      .filter((row) => typeof row.businessCode === 'string' && row.businessCode.length > 0)
      .map((row) => toEvent(row));
  }

  private jitter(delayMs: number): number {
    return Math.round(delayMs * (0.5 + Math.random() * 0.5));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ── parsed-XML shapes (post removeNSPrefix) ──────────────────────────────────
interface RawEventData {
  code?: string;
  value?: string;
}
interface RawEvent {
  businessCode?: string;
  eventTime?: string;
  description?: string;
  eventDataList?: RawEventData[];
}
interface SoapParsed {
  Envelope?: {
    Body?: {
      Fault?: { faultstring?: string };
      getEventsForWaybillV1Response?: { return?: { eventsList?: RawEvent[] } };
    };
  };
}

function toEvent(row: RawEvent): DpdWaybillEvent {
  const eventData = (row.eventDataList ?? [])
    .map((d) => d.value)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  return {
    businessCode: row.businessCode as string,
    eventTime: typeof row.eventTime === 'string' ? row.eventTime : undefined,
    description: typeof row.description === 'string' ? row.description : undefined,
    eventData: eventData.length > 0 ? eventData : undefined,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildEnvelope(waybill: string, auth: SoapAuth): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:even="${SOAP_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <even:getEventsForWaybillV1>
      <waybill>${escapeXml(waybill)}</waybill>
      <eventsSelectType>${DPD_EVENTS_SELECT_ALL}</eventsSelectType>
      <language>${DPD_EVENT_LANGUAGE}</language>
      <authDataV1>
        <channel></channel>
        <login>${escapeXml(auth.login)}</login>
        <password>${escapeXml(auth.password)}</password>
      </authDataV1>
    </even:getEventsForWaybillV1>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * DPD InfoServices SOAP Client — unit tests
 *
 * Mocks global `fetch` to verify envelope construction, response parsing
 * (multi- and single-event, the array-collapse guard), SOAP-fault mapping
 * (auth vs generic, fault-on-HTTP-200), and transient-retry behaviour (#965).
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/http
 */
import { DpdUnauthorizedException } from '../../../domain/exceptions/dpd-unauthorized.exception';
import { DpdTrackingException } from '../../../domain/exceptions/dpd-tracking.exception';
import { DpdNetworkException } from '../../../domain/exceptions/dpd-network.exception';
import { DpdInfoSoapClient } from '../dpd-info-soap-client';

const ENDPOINT = 'https://dpdinfoservicesdemo.dpd.com.pl/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents';
const AUTH = { login: 'test', password: 'secret&<pw>' };

const fetchMock = jest.fn();

function soapResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: () => Promise.resolve(body) } as unknown as Response;
}

function eventsEnvelope(rows: string): string {
  return `<?xml version="1.0"?>
<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <ns2:getEventsForWaybillV1Response xmlns:ns2="http://events.dpdinfoservices.dpd.com.pl/">
      <return><confirmId>abc=</confirmId>${rows}</return>
    </ns2:getEventsForWaybillV1Response>
  </S:Body>
</S:Envelope>`;
}

const ROW_COLLECTED = `<eventsList><businessCode>040101</businessCode><eventTime>2026-06-10T08:00:00</eventTime><waybill>WB1</waybill></eventsList>`;
const ROW_DELIVERED = `<eventsList><businessCode>190101</businessCode><eventTime>2026-06-11T14:30:00</eventTime><waybill>WB1</waybill></eventsList>`;

const FAULT_AUTH = `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><S:Fault><faultcode>S:Server</faultcode><faultstring>Access denied to secured webserwis method</faultstring></S:Fault></S:Body></S:Envelope>`;
const FAULT_OTHER = `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><S:Fault><faultcode>S:Server</faultcode><faultstring>Invalid waybill format</faultstring></S:Fault></S:Body></S:Envelope>`;

describe('DpdInfoSoapClient', () => {
  let client: DpdInfoSoapClient;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    // Tiny backoff so the retry test doesn't wait real seconds.
    client = new DpdInfoSoapClient(ENDPOINT, AUTH, { initialDelayMs: 1, maxRetries: 2 });
  });

  it('POSTs a SOAP envelope carrying the waybill + escaped auth and parses events', async () => {
    fetchMock.mockResolvedValueOnce(soapResponse(eventsEnvelope(ROW_COLLECTED + ROW_DELIVERED)));

    const events = await client.getEventsForWaybill({ waybill: 'WB1' });

    expect(events).toEqual([
      { businessCode: '040101', eventTime: '2026-06-10T08:00:00' },
      { businessCode: '190101', eventTime: '2026-06-11T14:30:00' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    const body = init.body as string;
    expect(body).toContain('<waybill>WB1</waybill>');
    expect(body).toContain('<eventsSelectType>ALL</eventsSelectType>');
    expect(body).toContain('<login>test</login>');
    // Password XML-escaped, never raw.
    expect(body).toContain('<password>secret&amp;&lt;pw&gt;</password>');
  });

  it('parses a single event (array-collapse guard)', async () => {
    fetchMock.mockResolvedValueOnce(soapResponse(eventsEnvelope(ROW_DELIVERED)));
    const events = await client.getEventsForWaybill({ waybill: 'WB1' });
    expect(events).toHaveLength(1);
    expect(events[0].businessCode).toBe('190101');
  });

  it('returns [] when the waybill has no events', async () => {
    fetchMock.mockResolvedValueOnce(soapResponse(eventsEnvelope('')));
    await expect(client.getEventsForWaybill({ waybill: 'WB1' })).resolves.toEqual([]);
  });

  it('maps an auth SOAP fault (on HTTP 200) to DpdUnauthorizedException', async () => {
    fetchMock.mockResolvedValueOnce(soapResponse(FAULT_AUTH, true, 200));
    await expect(client.getEventsForWaybill({ waybill: 'WB1' })).rejects.toBeInstanceOf(
      DpdUnauthorizedException,
    );
  });

  it('maps a non-auth SOAP fault to DpdTrackingException', async () => {
    fetchMock.mockResolvedValueOnce(soapResponse(FAULT_OTHER, false, 500));
    await expect(client.getEventsForWaybill({ waybill: 'WB1' })).rejects.toBeInstanceOf(
      DpdTrackingException,
    );
  });

  it('retries a transient network error then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(soapResponse(eventsEnvelope(ROW_DELIVERED)));
    const events = await client.getEventsForWaybill({ waybill: 'WB1' });
    expect(events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries and throws DpdNetworkException', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(client.getEventsForWaybill({ waybill: 'WB1' })).rejects.toBeInstanceOf(
      DpdNetworkException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

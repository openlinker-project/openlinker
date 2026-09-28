/**
 * A direct read of Subiekt, through the bridge (#3365 audit).
 *
 * Every Subiekt assertion in this suite reads an OpenLinker row. That proves
 * what OpenLinker BELIEVES - a `syncStatus` entry saying `synced`, an
 * `InvoiceRecord` carrying a number - and the audit's sharpest finding was that
 * no test anywhere checks the other end: whether a ZK, a kontrahent and the
 * money actually exist in Subiekt.
 *
 * The bridge already answers that. `GET /api/orders/{id}` returns the document
 * number, the contractor's name and NIP, the currency, the gross total and the
 * lines - read straight out of `dok__Dokument` / `dok_Pozycja`. It needed no
 * new endpoint, only a caller.
 *
 * ## Why this needs its own URL and token
 *
 * The connection's own `config.bridgeBaseUrl` is `host.docker.internal:5056` -
 * correct for the worker container and unreachable from the test process, which
 * runs on the host. And the bearer token lives encrypted in
 * `integration_credentials`, which a test client has no business decrypting.
 * So both are supplied explicitly.
 *
 * ## Absent configuration ANNOTATES, it does not skip
 *
 * A spec that cannot reach the bridge still asserts everything it can on the
 * OpenLinker side and records, in the run, exactly which claim went unverified.
 * A silent skip is what let the suite report green while proving nothing, and
 * replacing one silent skip with another would be no improvement.
 *
 * @module src/api
 */

/** One position on a Subiekt document, as the bridge reports it. */
export interface SubiektOrderLine {
  readonly towarSymbol: string;
  readonly nazwa: string | null;
  readonly ilosc: number;
  readonly wartoscBrutto: number;
}

/** A ZK as Subiekt itself holds it. */
export interface SubiektOrderDetail {
  readonly id: number;
  readonly numer: string;
  readonly dataWystawienia: string;
  readonly kontrahentNazwa: string | null;
  readonly kontrahentNip: string | null;
  readonly kontrahentEmail: string | null;
  readonly waluta: string;
  readonly wartoscBrutto: number;
  readonly lines: readonly SubiektOrderLine[];
}

export class SubiektBridgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  /**
   * Read a ZK by the id Subiekt assigned it - the value OpenLinker stores as
   * `syncStatus[].externalOrderId`.
   *
   * `null` when the bridge does not have it, which is a real answer: it is what
   * a caller asserting "the ZK exists" must be able to fail on.
   */
  async getOrder(documentId: string | number): Promise<SubiektOrderDetail | null> {
    const response = await fetch(`${this.baseUrl}/api/orders/${documentId}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Subiekt bridge answered HTTP ${response.status} reading order ${documentId}`,
      );
    }
    const envelope = (await response.json()) as {
      success: boolean;
      data: SubiektOrderDetail | null;
    };
    return envelope.success ? envelope.data : null;
  }

  /** The bridge's own liveness, so a spec can tell "not configured" from "down". */
  async isReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * The client, or `null` when this stack did not configure one.
 *
 * `null` is the signal to annotate rather than to skip - see the module header.
 */
export function buildSubiektBridgeClient(): SubiektBridgeClient | null {
  const baseUrl = process.env.E2E_SUBIEKT_BRIDGE_URL?.trim();
  const token = process.env.E2E_SUBIEKT_BRIDGE_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return new SubiektBridgeClient(baseUrl.replace(/\/+$/, ''), token);
}

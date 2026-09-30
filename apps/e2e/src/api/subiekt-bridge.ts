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
  /**
   * WHICH kontrahent this ZK is billed to - `dok_PlatnikId`, the document's own
   * column.
   *
   * The only field here that can tell two buyers apart. Two customers sharing a
   * surname produce identical `kontrahentNazwa` / `kontrahentNip` /
   * `kontrahentEmail` whether they landed on one card or two, so an assertion
   * about kontrahent IDENTITY has to read this one.
   *
   * `null` only for a document with no payer at all.
   */
  readonly kontrahentId: number | null;
  readonly waluta: string;
  readonly wartoscBrutto: number;
  readonly lines: readonly SubiektOrderLine[];
}

/** One warehouse's figures for a towar, as `GET /api/inventory/{symbol}/stock` reports them. */
export interface SubiektStockPosition {
  magazynId: number;
  magazynSymbol: string;
  stan: number;
  stanRez: number;
}

/** A towar's stock across every warehouse, plus which one Subiekt treats as default. */
export interface SubiektStock {
  towarSymbol: string;
  positions: SubiektStockPosition[];
  domyslnyMagazynId: number | null;
}

/** What the bridge answers after moving stock. `stanAfter` is Subiekt's own post-write figure. */
export interface SubiektStockAdjustment {
  deduplicated: boolean;
  documentId: number | null;
  documentNumber: string | null;
  stanAfter: number;
}

/**
 * A warehouse release as Subiekt itself holds it (#3365).
 *
 * `positionCount` is reported beside existence because a WZ can be a row and
 * still release nothing - the bridge's own `EnsureWarehouseRelease` records
 * hitting exactly that, where the document was linked to the ZK without the
 * specification being copied onto it.
 */
export interface SubiektWarehouseRelease {
  id: number;
  numer: string;
  carriesStockMovement: boolean;
  magazynId: number | null;
  positionCount: number;
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

  /**
   * Subiekt's OWN stock figure for a towar, per warehouse.
   *
   * This is the reading a stock assertion must start and end on: OpenLinker's
   * `inventory_items` is a mirror, so comparing the mirror against itself
   * proves nothing about whether Subiekt and the channel agree.
   *
   * `null` when the bridge does not know the symbol, which is a real answer and
   * the one a caller asserting "this towar exists" must be able to fail on.
   */
  async getStock(towarSymbol: string): Promise<SubiektStock | null> {
    const response = await fetch(
      `${this.baseUrl}/api/inventory/${encodeURIComponent(towarSymbol)}/stock`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Subiekt bridge answered HTTP ${response.status} reading stock for ${towarSymbol}`,
      );
    }
    const envelope = (await response.json()) as { success: boolean; data: SubiektStock | null };
    return envelope.success ? envelope.data : null;
  }

  /**
   * Move a towar's stock by `delta`, which Subiekt records as a real document
   * (a PW for a positive delta). A zero delta is refused by the bridge.
   *
   * `idempotencyKey` is mandatory here even though the bridge treats it as
   * optional: a retried adjustment without one moves the stock twice, and a
   * spec that re-runs is exactly the caller that would.
   */
  async adjustStock(input: {
    towarSymbol: string;
    delta: number;
    magazynId?: number;
    uwagi?: string;
    idempotencyKey: string;
  }): Promise<SubiektStockAdjustment> {
    const response = await fetch(`${this.baseUrl}/api/inventory/adjust`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(
        `Subiekt bridge answered HTTP ${response.status} adjusting ${input.towarSymbol} ` +
          `by ${input.delta}`,
      );
    }
    const envelope = (await response.json()) as {
      success: boolean;
      data: SubiektStockAdjustment | null;
      error: unknown;
    };
    if (!envelope.success || envelope.data === null) {
      throw new Error(
        `Subiekt bridge refused to adjust ${input.towarSymbol}: ${JSON.stringify(envelope.error)}`,
      );
    }
    return envelope.data;
  }

  /**
   * The warehouse release Subiekt holds under this number, or `null`.
   *
   * The counterpart to the number OpenLinker records at issue time: without
   * this read a caller asserting "the goods left the warehouse" can only
   * re-read OpenLinker's own field, which proves the value was written down
   * rather than that the document exists.
   */
  async getWarehouseRelease(numer: string): Promise<SubiektWarehouseRelease | null> {
    const url = `${this.baseUrl}/api/warehouse-releases?numer=${encodeURIComponent(numer)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Subiekt bridge answered HTTP ${response.status} reading warehouse release ${numer}`,
      );
    }
    const envelope = (await response.json()) as {
      success: boolean;
      data: SubiektWarehouseRelease | null;
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

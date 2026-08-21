import { EntityLabel } from '@openlinker/web';

/**
 * Ported from /dev/ui: the primitives-section identity row and the
 * patterns-section orders-table "Order" column, where EntityLabel is the
 * canonical identity cell (human name + shortened mono internal id + Copy).
 *
 * Skipped on purpose: `loading` renders a single faint "…" that reads as a
 * broken cell rather than a state, and a name-less label renders the literal
 * word "Unknown" — both are real behaviours but neither teaches the component.
 */

const stack = { display: 'flex', flexDirection: 'column', gap: 12 } as const;

export const IdentityRows = () => (
  <div style={stack}>
    <EntityLabel id="ol_order_a4f3b9c" name="ALG-2026-05-17-882414" to="#" />
    <EntityLabel id="ol_order_b18e4d1" name="PS-104822" to="#" />
    <EntityLabel id="ol_order_c0271fa" name="AM-202-9920381" to="#" />
  </div>
);

export const InTableColumn = () => (
  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
    <caption className="sr-only">Recent orders</caption>
    <tbody>
      {[
        { internalId: 'ol_order_9f3a1c2', externalId: '#10482', total: '€84.20' },
        { internalId: 'ol_order_71bd044', externalId: '#10481', total: '€219.00' },
        { internalId: 'ol_order_5c0e8a7', externalId: '#10479', total: '€32.90' },
      ].map((row) => (
        <tr key={row.internalId}>
          <td style={{ padding: '8px 0' }}>
            <EntityLabel id={row.internalId} name={row.externalId} />
          </td>
          <td className="mono tabular" style={{ padding: '8px 0', textAlign: 'right' }}>
            {row.total}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

/**
 * `showId` / `showCopy` are the two opt-outs a composite uses when it renders
 * its own id chip or its own copy control beside the label (#2027) — so the
 * same id never grows two copy buttons.
 */
export const Opts = () => (
  <div style={stack}>
    <EntityLabel id="ol_shipment_a3f24b09" name="INPOST-6210094418" />
    <EntityLabel id="ol_shipment_a3f24b09" name="INPOST-6210094418" showCopy={false} />
    <EntityLabel id="ol_shipment_a3f24b09" name="INPOST-6210094418" showId={false} />
  </div>
);

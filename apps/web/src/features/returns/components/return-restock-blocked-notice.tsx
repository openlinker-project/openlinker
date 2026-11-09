/**
 * Return Restock Blocked Notice (#2381, returns spec § 5.4)
 *
 * The highest-severity surface in the returns spec, and the reason the whole
 * feature earns its keep: **a restock that silently no-ops is worse than none.**
 * The operator believes stock came back, sells it, and learns otherwise from a
 * buyer.
 *
 * Four rules shape it.
 *
 * **It is persistent, and it is read from the SERVER.** § 5.4: *"A toast is not
 * sufficient and must not be the only signal"* — and a notice fed from the
 * dispose response would be exactly that, an error that vanishes on reload.
 * The block arrives on the detail read; the response's own `restockBlocked` is
 * an EVENT (*"the thing you just clicked was blocked"*) and only ever drives a
 * toast.
 *
 * **It never claims OpenLinker did something it did not.** The body says the
 * disposition was recorded and the stock was not changed, in that order, and
 * names the system that refused so the operator knows which book to open.
 *
 * **The explainer is an inline disclosure**, not a modal and not a link out. It
 * carries no blame, no jargon and no promise of a fix date: the real remedy is
 * implementing `adjustInventory` on that master, which is a scheduling decision.
 *
 * **The attested state is neutral, not success.** OpenLinker did not succeed at
 * anything — a human did the work — so the terminal row states that plainly and
 * offers no actions. A resolution that left the alarm ringing would train the
 * operator to ignore the alarm; one that left no trace would train them to
 * distrust the click.
 *
 * @module apps/web/src/features/returns/components
 */
import { useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { interpolate, renderRich, useFormat, useMessages } from '../../../shared/i18n';
import type { ReturnRestockAttestation, ReturnRestockBlock } from '../api/returns.types';

interface ReturnRestockBlockedNoticeProps {
  /** Outstanding blocks for THIS line. Never the whole return's. */
  blocks: ReturnRestockBlock[];
  /** Attestations for this line — the terminal state. */
  attestations: ReturnRestockAttestation[];
  /** The line's own sku, used when the block did not carry one. */
  lineSku: string | null;
  /** Resolves "by you" vs "by another operator" — never a name. */
  sessionUserId: string | null;
  pending: boolean;
  onAttest: () => void;
}

function AttestedRow({
  attestation,
  sessionUserId,
}: {
  attestation: ReturnRestockAttestation;
  sessionUserId: string | null;
}): ReactElement {
  const copy = useMessages('returns').restockAttested;
  const format = useFormat();
  // Never a name and never a raw id: nothing in the tree resolves a user id to
  // a display name, so the honest options are "you" and "another operator".
  const template =
    attestation.actorUserId !== null && attestation.actorUserId === sessionUserId
      ? copy.byYou
      : copy.byOther;

  return (
    <p className="returns-restock-attested text-muted">
      {interpolate(template, { date: format.date(attestation.occurredAt) })}{' '}
      {/* The load-bearing half — never dropped, whatever the attribution. */}
      {copy.disclaimer}
    </p>
  );
}

export function ReturnRestockBlockedNotice({
  blocks,
  attestations,
  lineSku,
  sessionUserId,
  pending,
  onAttest,
}: ReturnRestockBlockedNoticeProps): ReactElement | null {
  if (blocks.length === 0) {
    // Disjoint by construction: attesting flips the act out of the blocked set,
    // so a line is in at most one of these at a time.
    return attestations.length === 0 ? null : (
      <>
        {attestations.map((attestation) => (
          <AttestedRow
            attestation={attestation}
            key={attestation.eventId}
            sessionUserId={sessionUserId}
          />
        ))}
      </>
    );
  }

  // Grouped BY CONNECTION, then summed within each group.
  //
  // Summing across connections and labelling the total with one name would be a
  // false claim: `masterConnectionId` is persisted per ACT, so if the operator
  // changes which connection owns their stock between two dispose attempts on
  // one line, the acts genuinely name different masters — and "Add 5 x SKU-1 in
  // A" would send them to add units that belong in B. Rare, but it is the UI
  // asserting something the backend never said, on the surface whose whole job
  // is telling them where to go.
  //
  // In the overwhelmingly common single-master case this is exactly one group,
  // so the output is unchanged — N identical red boxes would read as N problems.
  const groups = groupBlocksByConnection(blocks);

  return (
    <>
      {groups.map((group) => (
        <RestockBlockedAlarm
          group={group}
          key={group.connectionId ?? 'unknown'}
          lineSku={lineSku}
          onAttest={onAttest}
          pending={pending}
        />
      ))}
    </>
  );
}

/** One alarm's worth of blocks: same line, same master. */
interface BlockGroup {
  connectionId: string | null;
  connectionName: string | null;
  quantity: number;
  sku: string | null;
}

function groupBlocksByConnection(blocks: ReturnRestockBlock[]): BlockGroup[] {
  const byConnection = new Map<string, BlockGroup>();

  for (const block of blocks) {
    // `null` is its own group — "we could not name the master" is a distinct
    // fact from any named one, and folding it into a named group would attribute
    // units to a connection the act did not record.
    const key = block.connectionId ?? '\u0000unknown';
    const existing = byConnection.get(key);

    if (existing === undefined) {
      byConnection.set(key, {
        connectionId: block.connectionId,
        connectionName: block.connectionName,
        quantity: block.quantity,
        sku: block.sku,
      });
      continue;
    }

    existing.quantity += block.quantity;
    existing.connectionName = existing.connectionName ?? block.connectionName;
    existing.sku = existing.sku ?? block.sku;
  }

  return [...byConnection.values()];
}

function RestockBlockedAlarm({
  group,
  lineSku,
  pending,
  onAttest,
}: {
  group: BlockGroup;
  lineSku: string | null;
  pending: boolean;
  onAttest: () => void;
}): ReactElement {
  const [explainerOpen, setExplainerOpen] = useState(false);
  const copy = useMessages('returns').restockBlocked;
  const explainer = useMessages('returns').restockBlockedExplainer;

  const { connectionId, connectionName, quantity } = group;
  const sku = group.sku ?? lineSku;
  const bold = { b: (text: string) => <strong>{text}</strong> };

  const body =
    connectionName === null
      ? renderRich(copy.bodyUnknownConnection, bold)
      : renderRich(copy.body, bold, { connection: connectionName });

  const remedy =
    connectionName === null
      ? sku === null
        ? interpolate(copy.remedyUnknownSkuAndConnection, { quantity })
        : interpolate(copy.remedyUnknownConnection, { quantity, sku })
      : sku === null
        ? interpolate(copy.remedyUnknownSku, { quantity, connection: connectionName })
        : interpolate(copy.remedy, { quantity, sku, connection: connectionName });

  const explainerBody =
    connectionName === null
      ? renderRich(explainer.bodyUnknownConnection, bold)
      : renderRich(explainer.body, bold, { connection: connectionName });

  return (
    <Alert tone="error">
      <p className="returns-restock-blocked__body">
        <strong>{copy.title}</strong> {body}
      </p>
      <p className="returns-restock-blocked__remedy">{remedy}</p>

      <div className="returns-restock-blocked__actions">
        <Button disabled={pending} onClick={onAttest} type="button">
          {copy.attest}
        </Button>
        {/* Absent, not disabled, when no connection resolved: a link that
            cannot go anywhere is worse than no link. */}
        {connectionId !== null ? (
          <Button
            onClick={() => window.open(`/connections/${connectionId}`, '_blank', 'noopener')}
            tone="secondary"
            type="button"
          >
            {connectionName === null
              ? copy.openUnknownConnection
              : interpolate(copy.openConnection, { connection: connectionName })}
          </Button>
        ) : null}
        <Button
          aria-expanded={explainerOpen}
          onClick={() => setExplainerOpen((open) => !open)}
          tone="secondary"
          type="button"
        >
          {explainerOpen ? copy.whyCollapse : copy.why}
        </Button>
      </div>

      {explainerOpen ? (
        <div className="returns-restock-blocked__explainer">
          <p>
            <strong>{explainer.heading}</strong>
          </p>
          <p>{explainerBody}</p>
          <p>{explainer.reassurance}</p>
        </div>
      ) : null}
    </Alert>
  );
}

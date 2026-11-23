/**
 * "Droga zestawu" (the bundle's journey): four steps from a saved composition to
 * the first parcel. After saving a bundle nothing said what comes next - an
 * offer, an order, a document, a parcel - so this checklist sits at the top of
 * the bundle page and says which step is done and which one to take now.
 *
 * Step 4 has no measurable "done": whether a document and a parcel came out
 * right is only visible on an order, so it points there instead of claiming a
 * state it cannot read.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';

export interface BundleJourneyProps {
  componentCount: number;
  listedCount: number;
  channelCount: number;
  /** Units sold in the last 30 days; `null` while unknown. */
  sold: number | null;
  listHref: string;
}

interface Step {
  id: string;
  done: boolean;
  title: string;
  hint: string;
  action: ReactNode;
}

export function BundleJourney({
  componentCount,
  listedCount,
  channelCount,
  sold,
  listHref,
}: BundleJourneyProps): ReactElement {
  const copy = useMessages('bundles').journey;
  const hasOrder = (sold ?? 0) > 0;
  const steps: Step[] = [
    {
      id: 'composition',
      done: componentCount > 0,
      title: copy.composition.title,
      hint: copy.composition.hint,
      action: null,
    },
    {
      id: 'offer',
      done: listedCount > 0,
      title: copy.offer.title,
      hint:
        channelCount === 0
          ? copy.offer.noChannel
          : interpolate(copy.offer.hint, { listed: listedCount, total: channelCount }),
      action:
        channelCount > 0 && listedCount === 0 ? (
          <Link className="button button--primary button--sm" to={listHref} data-testid="journey-list-offer">
            {copy.offer.action}
          </Link>
        ) : null,
    },
    {
      id: 'order',
      done: hasOrder,
      title: copy.order.title,
      hint: copy.order.hint,
      action: (
        <Link className="button button--ghost button--sm" to="/orders?withBundle=true">
          {copy.order.action}
        </Link>
      ),
    },
    {
      id: 'document',
      done: false,
      title: copy.document.title,
      hint: copy.document.hint,
      action: null,
    },
  ];
  const nextId = steps.find((step) => !step.done)?.id ?? null;
  return (
    <ol className="ux-journey" aria-label={copy.title} data-testid="bundle-journey">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={[
            'ux-journey__step',
            step.done ? 'is-done' : '',
            step.id === nextId ? 'is-next' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ animationDelay: `${index * 60}ms` }}
          data-testid={`journey-step-${step.id}`}
        >
          <span className="ux-journey__n" aria-hidden="true">
            {step.done ? '✓' : index + 1}
          </span>
          <span className="ux-journey__body">
            <strong>{step.title}</strong>
            <small title={step.hint}>{step.hint}</small>
            {step.action}
          </span>
          <span className="sr-only">{step.done ? copy.done : step.id === nextId ? copy.next : copy.later}</span>
        </li>
      ))}
    </ol>
  );
}

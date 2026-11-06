/**
 * PeekPanel (#4026, shared by #4027)
 *
 * The "peek" a list row opens: a `SidePanel` (bottom sheet on phones) with the
 * row's identity in the header, a Previous / Next footer and ↑ ↓ / j k to walk
 * the visible rows without closing it. Each list supplies its own header and
 * body; the walk, the footer and the state card look the same everywhere.
 *
 * @module shared/ui
 */
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { interpolate } from '../i18n/interpolate';
import { useMessages } from '../i18n/use-messages';
import { Button } from './button';
import { SidePanel } from './side-panel';

export interface PeekPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  meta?: ReactNode;
  headerAside?: ReactNode;
  /** Screen-reader description of the panel. */
  description: string;
  /** 1-based position among the visible rows. */
  position: number;
  count: number;
  onNavigate: (step: -1 | 1) => void;
  /** Changes when the shown row changes, so the body scrolls back to the top. */
  bodyKey?: string;
  children: ReactNode;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export function PeekPanel({
  open,
  onOpenChange,
  title,
  meta,
  headerAside,
  description,
  position,
  count,
  onNavigate,
  bodyKey,
  children,
}: PeekPanelProps): ReactElement {
  const copy = useMessages('ui').peekPanel;
  const hasPrevious = position > 1;
  const hasNext = position < count;

  useEffect(() => {
    if (!open) return undefined;
    function onKeydown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if ((e.key === 'ArrowDown' || e.key === 'j') && hasNext) {
        e.preventDefault();
        onNavigate(1);
      } else if ((e.key === 'ArrowUp' || e.key === 'k') && hasPrevious) {
        e.preventDefault();
        onNavigate(-1);
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('keydown', onKeydown);
    };
  }, [open, hasNext, hasPrevious, onNavigate]);

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      width={560}
      className="peek-panel"
      closeIcon
      closeLabel={copy.close}
      title={title}
      meta={meta}
      headerAside={headerAside}
      description={description}
      footer={
        <div className="peek-panel__foot">
          <span className="text-muted mono tabular">
            {interpolate(copy.position, { index: String(position), count: String(count) })}
          </span>
          <span className="button-group">
            <Button
              tone="secondary"
              className="button--sm"
              disabled={!hasPrevious}
              onClick={() => {
                onNavigate(-1);
              }}
            >
              {copy.previous}
            </Button>
            <Button
              tone="secondary"
              className="button--sm"
              disabled={!hasNext}
              onClick={() => {
                onNavigate(1);
              }}
            >
              {copy.next}
            </Button>
          </span>
        </div>
      }
    >
      {open ? (
        <div className="peek-panel__body" key={bodyKey}>
          {children}
        </div>
      ) : null}
    </SidePanel>
  );
}

export interface PeekStateRow {
  label: string;
  value: ReactNode;
}

/** The labelled state rows near the top of a peek (status, stock, ...). */
export function PeekStateCard({ label, rows }: { label: string; rows: readonly PeekStateRow[] }): ReactElement {
  return (
    <section className="peek-panel__state" aria-label={label}>
      {rows.map((row) => (
        <div key={row.label} className="peek-panel__state-row">
          <span className="eyebrow">{row.label}</span>
          <div className="peek-panel__state-value">{row.value}</div>
        </div>
      ))}
    </section>
  );
}

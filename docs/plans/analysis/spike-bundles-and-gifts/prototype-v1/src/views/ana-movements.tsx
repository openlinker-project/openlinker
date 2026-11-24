/**
 * "Ruchy magazynowe" tab: the stock movement ledger (mirrors StockMovementsTable and
 * the Stock movements page) with reason chips for gift and bundle component.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Alert } from '@web/shared/ui/alert';
import { Button } from '@web/shared/ui/button';
import { Chip, type ChipTone } from '@web/shared/ui/chip';
import { DataTable, type DataTableColumn } from '@web/shared/ui/data-table';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { useToast } from '@web/shared/ui/toast-provider';
import { useFormat } from '@web/shared/i18n/use-format';
import { CHANNELS, MASTERS, VARIANTS } from '../model/catalog';
import { useProto, useWriteGuard } from '../proto';
import { BundleMark, GiftMark } from '../ui/marks';
import { AnaPanel } from './ana-shared';
import { MOVEMENTS, type Movement, type MovementType } from './ana-data';

export type MovementsMode = 'gift' | 'bundle-components';
type Filter = 'all' | 'sale' | 'gift' | 'bundle-component' | 'manual' | 'return' | 'sync';

const TYPE: Record<MovementType, { label: string; chip: string }> = {
  sale: { label: 'Sprzedaż', chip: '' },
  gift: { label: 'Gratis', chip: 'chip--review' },
  'bundle-component': { label: 'Składnik zestawu', chip: 'chip--info' },
  manual: { label: 'Korekta ręczna', chip: 'chip--warning' },
  return: { label: 'Zwrot', chip: 'chip--success' },
  sync: { label: 'Zmiana z synchronizacji', chip: 'stock-movement-chip--muted' },
};

const FILTERS: { value: Filter; label: string; tone?: ChipTone }[] = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'sale', label: 'Sprzedaż' },
  { value: 'gift', label: 'Gratis', tone: 'review' },
  { value: 'bundle-component', label: 'Składnik zestawu', tone: 'info' },
  { value: 'manual', label: 'Korekta ręczna', tone: 'warning' },
  { value: 'return', label: 'Zwrot', tone: 'success' },
];

/** With OMS off, OpenLinker decrements nothing itself: the shop lowers stock and OL sees a sync change. */
function withOms(rows: Movement[], oms: boolean): Movement[] {
  if (oms) return rows;
  return rows
    .filter((m) => m.status !== 'refused')
    .map((m) =>
      m.type === 'gift' || m.type === 'bundle-component' || m.type === 'sale'
        ? { ...m, type: 'sync' as const, reason: 'Sklep zmienił stan, OpenLinker zobaczył to przy synchronizacji', order: undefined, giftSlot: false }
        : m,
    );
}

function matches(m: Movement, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'gift') return m.type === 'gift' || m.giftSlot === true || (m.type === 'manual' && /gratis/i.test(m.reason ?? ''));
  return m.type === f;
}

export function MovementsTab({ mode }: { mode: MovementsMode }): ReactElement {
  const { oms } = useProto();
  const fmt = useFormat();
  const guard = useWriteGuard();
  const { showToast } = useToast();
  const [filter, setFilter] = useState<Filter>(mode === 'gift' ? 'gift' : 'bundle-component');
  const all = useMemo(() => withOms(MOVEMENTS, oms), [oms]);
  const rows = all.filter((m) => matches(m, filter));
  const filters = oms ? FILTERS : [...FILTERS, { value: 'sync' as const, label: 'Synchronizacja' }];

  return (
    <AnaPanel
      eyebrow="Magazyn"
      title="Ruchy magazynowe"
      testId="ana-movements"
      actions={
        <Button tone="secondary" disabled={!guard.canWrite} title={guard.reason} onClick={() => showToast({ tone: 'info', description: 'Otwórz wariant, żeby dodać korektę ręczną z powodem.' })}>
          Dodaj korektę ręczną
        </Button>
      }
    >
      <div className="toolbar page-summary">
        <div className="toolbar__group ana-chips" role="group" aria-label="Powód ruchu">
          {filters.map((c) => (
            <Chip key={c.value} tone={c.tone} active={filter === c.value} onClick={() => setFilter(c.value)}>
              {c.label}
            </Chip>
          ))}
        </div>
      </div>
      {!oms ? (
        <Alert tone="info" density="compact" title="OMS jest wyłączony">
          Zamówienie trafia do PrestaShop z pozycją gratisu 0,00 zł i składnikami w pozycji zestawu, a sklep sam zdejmuje stan. OpenLinker widzi to jako zmianę z synchronizacji, bez powodu i bez numeru zamówienia. Powód „gratis” mają tylko korekty ręczne z trybu pilota.
        </Alert>
      ) : filter === 'gift' ? (
        <Alert tone="info" density="compact">
          Gratis schodzi ze stanu jak każda pozycja: zarezerwowany, zeskanowany na stanowisku pakowania i zdjęty ze stanu w sklepie, który go prowadzi, z powodem „gratis”. Także gdy kanał (Allegro, Erli) nic o gratisie nie wie.
        </Alert>
      ) : filter === 'bundle-component' ? (
        <Alert tone="info" density="compact">
          Zestaw nie ma własnego stanu. Każdy składnik ma osobny ruch z identyfikatorem pozycji zakończonym nazwą składnika, a rezerwacje i pakowanie idą po składnikach.
        </Alert>
      ) : null}
      <p className="stock-movements-summary-line">{fmt.number(rows.length)} {plRuch(rows.length)}</p>
      {rows.length === 0 ? (
        <div className="empty-state">
          <h2>Brak ruchów z tym powodem</h2>
          <p>Wybierz inny powód albo „Wszystkie”.</p>
          <Button tone="secondary" onClick={() => setFilter('all')}>
            Pokaż wszystkie
          </Button>
        </div>
      ) : (
        <MovementsTable rows={rows} />
      )}
    </AnaPanel>
  );
}

function plRuch(n: number): string {
  if (n === 1) return 'ruch';
  const d = n % 10;
  const h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'ruchy' : 'ruchów';
}

function when(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ${pad(d.getUTCHours() + 1)}:${pad(d.getUTCMinutes())}`;
}

function DeltaCell({ m }: { m: Movement }): ReactElement {
  const tone = m.status === 'refused' ? 'stock-movement__delta--void' : m.delta > 0 ? 'stock-movement__delta--pos' : 'stock-movement__delta--neg';
  return (
    <span>
      <span className={`mono-text tabular ${tone}`}>
        {m.delta > 0 ? '+' : ''}
        {m.delta}
      </span>{' '}
      <span className="mono-text tabular">{m.before}</span>
      <span className="stock-movement__arrow" aria-hidden="true">
        {' '}
        →{' '}
      </span>
      {m.status === 'refused' ? <span className="muted-text">nie zdjęto</span> : <span className="mono-text tabular">{m.after}</span>}
    </span>
  );
}

function TypeCell({ m }: { m: Movement }): ReactElement {
  const t = TYPE[m.type];
  return (
    <>
      <span className="ana-inline">
        <span className={['chip', t.chip].filter(Boolean).join(' ')}>{t.label}</span>
        {m.giftSlot ? <GiftMark compact /> : null}
        {m.type === 'bundle-component' && !m.giftSlot ? <BundleMark compact label="Składnik" /> : null}
      </span>
      {m.reason ? <div className="muted-text stock-movement__reason">{m.reason}</div> : null}
    </>
  );
}

function SourceCell({ m }: { m: Movement }): ReactElement {
  const { go } = useProto();
  let ref: ReactNode = <span className="muted-text">-</span>;
  if (m.type === 'return' && m.returnRef) {
    ref = (
      <button type="button" className="ana-linkbtn mono-text" onClick={() => go('returns')}>
        {m.returnRef}
      </button>
    );
  } else if (m.order) {
    ref = (
      <span className="data-table__stack">
        <button type="button" className="ana-linkbtn mono-text" onClick={() => go('order')}>
          {m.order.ref}
        </button>
        <span className="mono-text muted-text ana-small ana-break">{m.order.lineId}</span>
      </span>
    );
  } else if (m.actor) {
    ref = <span>{m.actor}</span>;
  }
  const kind = m.type === 'return' ? 'Zwrot' : m.order ? `Zamówienie · ${CHANNELS[m.order.channel].name}` : m.actor ? 'Operator' : 'Synchronizacja';
  return (
    <>
      <div className="muted-text stock-movement__source-kind">{kind}</div>
      {ref}
    </>
  );
}

function StatusCell({ m }: { m: Movement }): ReactElement {
  return (
    <>
      {m.status === 'refused' ? (
        <StatusBadge tone="error" compact withDot>Odrzucono</StatusBadge>
      ) : (
        <StatusBadge tone="success" compact withDot>Zastosowano</StatusBadge>
      )}
      {m.refusal ? <div className="muted-text stock-movement__reason">{m.refusal}</div> : null}
    </>
  );
}

function MovementsTable({ rows }: { rows: Movement[] }): ReactElement {
  const columns: DataTableColumn<Movement>[] = [
    { id: 'time', header: 'Czas', cell: (m) => <span className="mono-text tabular">{when(m.at)}</span> },
    {
      id: 'sku',
      header: 'SKU / wariant',
      cell: (m) => (
        <>
          <div>{m.label ?? VARIANTS[m.variant].name}</div>
          <div className="mono-text muted-text ana-small">{m.label ? 'ZES-PORANNY-PS' : VARIANTS[m.variant].sku}</div>
        </>
      ),
    },
    { id: 'type', header: 'Powód', cell: (m) => <TypeCell m={m} /> },
    { id: 'delta', header: 'Zmiana / przed → po', cell: (m) => <DeltaCell m={m} /> },
    { id: 'source', header: 'Źródło', hideBelow: 768, cell: (m) => <SourceCell m={m} /> },
    { id: 'master', header: 'Sklep prowadzący stan', hideBelow: 1024, cell: (m) => MASTERS[m.master].name },
    { id: 'status', header: 'Status', cell: (m) => <StatusCell m={m} /> },
  ];
  return (
    <DataTable
      caption="Ruchy magazynowe"
      className="stock-movements-table"
      columns={columns}
      rows={rows}
      rowKey={(m) => m.id}
      rowClassName={(m) => (m.status === 'refused' ? 'stock-movement-row--refused' : undefined)}
      cardView={{
        title: (m) => <TypeCell m={m} />,
        subtitle: (m) => `${when(m.at)} · ${m.label ?? VARIANTS[m.variant].sku}`,
        meta: (m) => <StatusCell m={m} />,
        summary: (m) => <DeltaCell m={m} />,
        detail: (m) => (
          <>
            <SourceCell m={m} />
            <div className="muted-text">{MASTERS[m.master].name}</div>
          </>
        ),
      }}
    />
  );
}

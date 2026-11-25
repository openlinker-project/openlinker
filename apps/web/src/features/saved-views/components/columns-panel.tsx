/**
 * ColumnsPanel
 *
 * "Columns & sort": the trigger button and the side panel behind it. Columns
 * can be shown, hidden and reordered three ways (native drag and drop, the
 * up/down buttons, Arrow Up/Down on the grip) and every stacked column opens a
 * "Fields" disclosure that does the same for the fields inside its cell.
 * Restore defaults resets columns, fields and sort.
 *
 * Presentational and controlled: it edits nothing itself, it reports the new
 * order. The side panel supplies the slide-in, scrim, focus trap, initial focus
 * and Escape-closes-top-layer behaviour.
 *
 * @module apps/web/src/features/saved-views/components
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type SyntheticEvent } from 'react';
import { interpolate } from '../../../shared/i18n/interpolate';
import { useMessages } from '../../../shared/i18n/use-messages';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { SidePanel } from '../../../shared/ui/side-panel';
import { useReorderDnd, type ReorderDnd } from '../hooks/use-reorder-dnd';
import { partsOf, reorder } from '../lib/column-parts';
import type { ViewSort } from '../lib/saved-view.types';
import type { ColumnDef, LockedColumnDef, SortOption } from '../lib/view-registry.types';
import { ViewIcon } from './view-icons';

export interface ColumnsPanelProps<Row> {
  columns: ColumnDef<Row>[];
  locked: Pick<LockedColumnDef<Row>, 'label' | 'description'>;
  /** Visible column ids, in order. */
  visibleIds: string[];
  parts: Record<string, string[]>;
  sort: ViewSort;
  sortOptions: SortOption[];
  /** Name shown for a sort that is not one of the options (e.g. chosen from a header). */
  sortFallbackLabel: string;
  /** The list keeps built-in views only: say that the choices are saved for this person. */
  showSavedForYouHint: boolean;
  onSortChange: (sort: ViewSort) => void;
  onColumnsChange: (ids: string[]) => void;
  onPartsChange: (columnId: string, ids: string[]) => void;
  onRestoreDefaults: () => void;
}

function MoveButtons({
  label,
  index,
  count,
  dnd,
}: {
  label: string;
  index: number;
  count: number;
  dnd: ReorderDnd;
}): ReactElement {
  const copy = useMessages('saved-views').columnsPanel;
  return (
    <>
      <button
        type="button"
        className="sv-reset sv-icon-btn sv-mv"
        aria-label={interpolate(copy.moveUp, { name: label })}
        disabled={index === 0}
        onClick={() => dnd.move(index, index - 1)}
      >
        <ViewIcon name="up" />
      </button>
      <button
        type="button"
        className="sv-reset sv-icon-btn sv-mv"
        aria-label={interpolate(copy.moveDown, { name: label })}
        disabled={index === count - 1}
        onClick={() => dnd.move(index, index + 1)}
      >
        <ViewIcon name="down" />
      </button>
    </>
  );
}

function Grip({
  id,
  label,
  onKeyDown,
}: {
  id: string;
  label: string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}): ReactElement {
  const copy = useMessages('saved-views').columnsPanel;
  return (
    <button
      type="button"
      className="sv-reset sv-grip"
      data-grip-id={id}
      aria-label={interpolate(copy.gripLabel, { name: label })}
      onKeyDown={onKeyDown}
    >
      <ViewIcon name="grip" />
    </button>
  );
}

function PartsEditor<Row>({
  column,
  parts,
  onChange,
  announce,
}: {
  column: ColumnDef<Row>;
  parts: Record<string, string[]>;
  onChange: (ids: string[]) => void;
  announce: (message: string) => void;
}): ReactElement {
  const copy = useMessages('saved-views').columnsPanel;
  const visible = partsOf(column, { parts });
  const visibleIdList = visible.map((part) => part.id);
  const hiddenParts = (column.parts ?? []).filter((part) => !visibleIdList.includes(part.id));

  const dnd = useReorderDnd((from, to) => {
    if (to < 0 || to >= visibleIdList.length) return;
    onChange(reorder(visibleIdList, from, to));
    announce(
      interpolate(copy.announcePart, {
        name: visible[from]?.label ?? '',
        to: to + 1,
        total: visibleIdList.length,
        column: column.label,
      }),
    );
  });

  // Rows are keyed by field id, so a move re-parents the focused grip; put focus back on it.
  useRefocusGrip(visibleIdList.join());

  const stop = (event: SyntheticEvent): void => event.stopPropagation();

  return (
    <div
      className="sv-partlist"
      role="group"
      aria-label={interpolate(copy.fieldsGroup, { name: column.label })}
      onDragStart={stop}
      onDragOver={stop}
      onDrop={stop}
      onDragEnd={stop}
    >
      <span className="sv-partlist__hint">{copy.fieldsHint}</span>
      {visible.map((part, index) => (
        <div key={part.id} className={dnd.rowClass(index, 'sv-colrow') + ' sv-colrow--sub'} {...dnd.rowProps(index)}>
          <Grip id={`${column.id}.${part.id}`} label={part.label} onKeyDown={dnd.gripKeyDown(index)} />
          <label>
            <input
              type="checkbox"
              checked
              disabled={visible.length === 1}
              onChange={() => onChange(visibleIdList.filter((id) => id !== part.id))}
            />
            <span className="sv-fld">
              <b>{part.label}</b>
            </span>
            {part.sort ? (
              <span className="sv-sortable" title={copy.sortableTitle}>
                <ViewIcon name="sort" size={12} />
              </span>
            ) : null}
          </label>
          <MoveButtons label={part.label} index={index} count={visible.length} dnd={dnd} />
        </div>
      ))}
      {hiddenParts.map((part) => (
        <div key={part.id} className="sv-colrow sv-colrow--sub sv-colrow--off">
          <span className="sv-grip sv-grip--placeholder" />
          <label>
            <input type="checkbox" checked={false} onChange={() => onChange(visibleIdList.concat(part.id))} />
            <span className="sv-fld">
              <b>{part.label}</b>
            </span>
          </label>
        </div>
      ))}
      {visible.length === 1 ? <span className="sv-partlist__hint">{copy.minOneField}</span> : null}
    </div>
  );
}

/** After the visible order changes, focus returns to the grip that last had it. */
function useRefocusGrip(orderKey: string): void {
  const focused = useRef<string | null>(null);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      focused.current =
        target instanceof HTMLElement && target.dataset.gripId ? target.dataset.gripId : null;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  useEffect(() => {
    const id = focused.current;
    if (!id) return;
    const grip = document.querySelector<HTMLElement>(`[data-grip-id="${CSS.escape(id)}"]`);
    if (grip && document.activeElement !== grip) grip.focus();
  }, [orderKey]);
}

export function ColumnsPanel<Row>(props: ColumnsPanelProps<Row>): ReactElement {
  const copy = useMessages('saved-views').columnsPanel;
  const [open, setOpen] = useState(false);
  const [openFields, setOpenFields] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { columns, visibleIds, parts } = props;

  const changeOpen = (next: boolean): void => {
    setOpen(next);
    // The panel is opened from a plain button, not a dialog trigger, so focus is handed back by hand.
    if (!next) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const byId = (id: string): ColumnDef<Row> | undefined => columns.find((column) => column.id === id);
  const hidden = columns.filter((column) => !visibleIds.includes(column.id));
  const sortValue = `${props.sort.key}:${props.sort.dir}`;
  const knownSort = props.sortOptions.some((option) => `${option.key}:${option.dir}` === sortValue);

  const dnd = useReorderDnd((from, to) => {
    if (to < 0 || to >= visibleIds.length) return;
    props.onColumnsChange(reorder(visibleIds, from, to));
    setLive(
      interpolate(copy.announceColumn, {
        name: byId(visibleIds[from] ?? '')?.label ?? '',
        // The locked first column counts as position 1.
        to: to + 2,
        total: visibleIds.length + 1,
      }),
    );
  });
  useRefocusGrip(visibleIds.join());

  return (
    <>
      <Button
        ref={triggerRef}
        tone="secondary"
        className="button--sm"
        style={{ height: '2rem' }}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <ViewIcon name="sliders" />
        {copy.trigger}
      </Button>
      <SidePanel
        open={open}
        onOpenChange={changeOpen}
        title={copy.title}
        description={copy.description}
        width={420}
        closeIcon
        closeLabel={copy.done}
        footer={
          <div className="sv-panel-foot">
            <Button tone="secondary" onClick={props.onRestoreDefaults}>
              {copy.restoreDefaults}
            </Button>
            <Button onClick={() => changeOpen(false)}>{copy.done}</Button>
          </div>
        }
      >
        {/* A list with no sort offers none: an empty select would promise an ordering the list cannot give. */}
        {props.sortOptions.length > 0 ? (
        <div className="sv-panel-sec">
          <div className="sv-field">
            <label className="sv-field__label" htmlFor="sv-columns-sort">
              {copy.sort}
            </label>
            <Select
              id="sv-columns-sort"
              className="sv-select"
              value={knownSort ? sortValue : ''}
              onChange={(event) => {
                const [key, dir] = event.target.value.split(':');
                if (key) props.onSortChange({ key, dir: dir === 'asc' ? 'asc' : 'desc' });
              }}
            >
              {!knownSort ? <option value="">{props.sortFallbackLabel}</option> : null}
              {props.sortOptions.map((option) => (
                <option key={`${option.key}:${option.dir}`} value={`${option.key}:${option.dir}`}>
                  {option.label}
                </option>
              ))}
            </Select>
            <span className="sv-field__hint">{copy.sortHint}</span>
          </div>
        </div>
        ) : null}
        <div className="sv-panel-sec">
          <div className="sv-field__label sv-field__label--spaced">{copy.columns}</div>
          <div className="sv-colrow sv-colrow--locked">
            <label>
              <ViewIcon name="lock" size={13} />
              <span className="sv-fld">
                <b>{props.locked.label}</b>
                {props.locked.description ? <span>{props.locked.description}</span> : null}
              </span>
            </label>
            <span className="sv-hint">{copy.always}</span>
          </div>
          {visibleIds.map((id, index) => {
            const column = byId(id);
            if (!column) return null;
            const fields = column.parts ? partsOf(column, { parts }) : [];
            const isOpen = openFields === id;
            return (
              <div key={id} className={dnd.rowClass(index, 'sv-colgrp')} {...dnd.rowProps(index)}>
                <div className="sv-colrow">
                  <Grip id={id} label={column.label} onKeyDown={dnd.gripKeyDown(index)} />
                  <label>
                    <input
                      type="checkbox"
                      checked
                      onChange={() => props.onColumnsChange(visibleIds.filter((other) => other !== id))}
                    />
                    <span className="sv-fld">
                      <b>{column.label}</b>
                      {column.parts || column.description ? (
                        <span>{column.parts ? fields.map((field) => field.label).join(', ') : column.description}</span>
                      ) : null}
                    </span>
                  </label>
                  <MoveButtons label={column.label} index={index} count={visibleIds.length} dnd={dnd} />
                  {column.parts ? (
                    <button
                      type="button"
                      className={['sv-reset', 'sv-disc', isOpen ? 'sv-disc--open' : ''].filter(Boolean).join(' ')}
                      aria-label={interpolate(copy.fieldsOf, { name: column.label })}
                      aria-expanded={isOpen}
                      onClick={() => setOpenFields(isOpen ? null : id)}
                    >
                      {copy.fieldsDisclosure}
                      <ViewIcon name="right" size={12} />
                    </button>
                  ) : (
                    <span className="sv-disc sv-disc--placeholder" aria-hidden="true" />
                  )}
                </div>
                {isOpen && column.parts ? (
                  <PartsEditor
                    column={column}
                    parts={parts}
                    announce={setLive}
                    onChange={(ids) => props.onPartsChange(id, ids)}
                  />
                ) : null}
              </div>
            );
          })}
          {hidden.length > 0 ? (
            <div className="sv-field__label sv-field__label--hidden">{copy.hidden}</div>
          ) : null}
          {hidden.map((column) => (
            <div key={column.id} className="sv-colrow">
              <label>
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => props.onColumnsChange(visibleIds.concat(column.id))}
                />
                <span className="sv-fld">
                  <b>{column.label}</b>
                  {column.description ? <span>{column.description}</span> : null}
                </span>
              </label>
            </div>
          ))}
        </div>
        {props.showSavedForYouHint ? (
          <div className="sv-panel-sec">
            <span className="sv-field__hint">{copy.noCustomViews}</span>
          </div>
        ) : null}
        <div className="sr-only" role="status" aria-live="polite">
          {live}
        </div>
      </SidePanel>
    </>
  );
}

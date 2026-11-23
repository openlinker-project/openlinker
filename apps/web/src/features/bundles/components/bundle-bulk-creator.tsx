/**
 * Bulk multipack creator: one row per selected product, one button.
 *
 * Opened from the products list selection bar. Every row becomes a bundle of
 * ONE component in a chosen pack size, created at a single product master and
 * then given its composition. Nothing is written until the button is pressed,
 * rows run one after another so the shop is never hit in parallel, and a
 * failure stays on its row so only the failed ones are retried. A product that
 * was already created by an earlier attempt is never created twice: the retry
 * resumes at the composition write.
 *
 * @module apps/web/src/features/bundles/components
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import type { ApiError } from '../../../shared/api/api-error';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { useDemoMode } from '../../system';
import { useSkuConflict } from '../hooks/use-sku-conflict';
import './bundle-bulk-creator.css';
import { toBundleChoice, type BundleProductChoice } from '../lib/bundle-choice';
import {
  DEFAULT_PACK_SIZE,
  MAX_BULK_ROWS,
  MAX_PACK_SIZE,
  MIN_PACK_SIZE,
  earlierDuplicateOf,
  isPackRowValid,
  packName,
  packPriceText,
  packSku,
  parsePackSize,
  readBulkErrorDetails,
  sameKey,
  uniquifyName,
  type BulkRowStatus,
} from '../lib/bundle-bulk-model';
import { parsePrice } from '../lib/bundle-form-model';
import { useBundleCreationTargetsQuery } from '../hooks/use-bundle-queries';
import { useCreateBundleProductMutation } from '../hooks/use-create-bundle-product-mutation';
import { useSaveBundleMutation } from '../hooks/use-save-bundle-mutation';

export interface BundleBulkCreatorProps {
  productIds: readonly string[];
}

type SkipReason = 'multiVariant' | 'bundle' | 'notFound' | 'tooMany';

/** Product lookups in flight at once while the table is seeded. */
const SEED_CONCURRENCY = 5;
/** More identical "could not load" lines than this collapse into one. */
const SKIP_COLLAPSE_ABOVE = 5;

async function mapWithLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        out[index] = { status: 'fulfilled', value: await task(items[index]) };
      } catch (reason) {
        out[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

interface SkippedProduct {
  productId: string;
  name: string;
  reason: SkipReason;
}

interface SeedResult {
  choices: BundleProductChoice[];
  skipped: SkippedProduct[];
}

type HaltReason = 'systemic' | 'stopped';

interface RowDerived {
  pack: number | null;
  name: string;
  sku: string;
  priceText: string;
  /** The first earlier row with the same name, when the name repeats. */
  dupName: string | null;
  dupSku: string | null;
}

interface BulkRow {
  choice: BundleProductChoice;
  packText: string;
  name: string | null;
  sku: string | null;
  priceText: string | null;
  status: BulkRowStatus;
  error: string | null;
  /** Set once the shop made the product, so a retry only writes the composition. */
  created: { variantId: string; productId: string } | null;
}

/**
 * What each row will send. Auto names are made unique across the batch here
 * (two products must not publish under one name); the rest is the row's own
 * suggestion until the operator types over it.
 */
function deriveRows(rows: readonly BulkRow[]): RowDerived[] {
  const taken = new Set(rows.filter((row) => row.name !== null).map((row) => sameKey(row.name ?? '')));
  const base = rows.map((row) => {
    const parsed = parsePackSize(row.packText);
    const pack = parsed ?? DEFAULT_PACK_SIZE;
    const sku = row.sku ?? packSku(row.choice.sku, pack);
    let name = row.name;
    if (name === null) {
      name = uniquifyName(packName(row.choice.name, pack), sku, taken);
      taken.add(sameKey(name));
    }
    return { pack: parsed, name, sku, priceText: row.priceText ?? packPriceText(row.choice.price, pack) };
  });
  const dupNames = earlierDuplicateOf(base.map((item) => item.name));
  const dupSkus = earlierDuplicateOf(base.map((item) => item.sku));
  return base.map((item, index) => ({
    ...item,
    dupName: dupNames[index] === null ? null : (rows[dupNames[index] as number]?.choice.name ?? ''),
    dupSku: dupSkus[index] === null ? null : (rows[dupSkus[index] as number]?.choice.name ?? ''),
  }));
}

/** Finds whether a typed SKU already belongs to a catalogue product; renders nothing. */
function SkuProbe({
  id,
  sku,
  enabled,
  onResult,
}: {
  id: string;
  sku: string;
  enabled: boolean;
  onResult: (id: string, name: string | null) => void;
}): null {
  const conflict = useSkuConflict(sku, enabled);
  const name = conflict?.name ?? null;
  useEffect(() => {
    onResult(id, name);
  }, [id, name, onResult]);
  return null;
}

export function BundleBulkCreator({ productIds }: BundleBulkCreatorProps): ReactElement {
  const copy = useMessages('bundles');
  const format = useFormat();
  const apiClient = useApiClient();
  const demoMode = useDemoMode();
  const write = useWriteAccess('bundles:write', demoMode);
  const targets = useBundleCreationTargetsQuery();
  const createProduct = useCreateBundleProductMutation();
  const save = useSaveBundleMutation();
  const idsKey = productIds.join(',');

  const seed = useQuery({
    queryKey: ['bundles', 'bulk-seed', idsKey],
    queryFn: async (): Promise<SeedResult> => {
      const result: SeedResult = { choices: [], skipped: [] };
      const wanted = productIds.slice(0, MAX_BULK_ROWS);
      productIds.slice(MAX_BULK_ROWS).forEach((id) => result.skipped.push({ productId: id, name: id, reason: 'tooMany' }));
      const settled = await mapWithLimit(wanted, SEED_CONCURRENCY, async (id) => {
        const product = await apiClient.products.getById(id);
        const only = (product.variants ?? []).length === 1 ? product.variants?.[0] : undefined;
        // Product detail carries no bundle mark, only list rows do, so ask the list
        // for exactly this product. A failed lookup leaves the row in; the master
        // refuses a bundle of a bundle on save.
        let bundleVariantId = product.bundle?.variantId ?? null;
        if (only !== undefined && bundleVariantId === null) {
          try {
            const page = await apiClient.products.listRows({ productId: id }, { limit: 1, offset: 0 });
            bundleVariantId = page.items[0]?.bundle?.variantId ?? null;
          } catch {
            bundleVariantId = null;
          }
        }
        return { product, only, bundleVariantId };
      });
      settled.forEach((outcome, index) => {
        const id = wanted[index] ?? '';
        if (outcome.status !== 'fulfilled') {
          result.skipped.push({ productId: id, name: id, reason: 'notFound' });
          return;
        }
        const { product, only, bundleVariantId } = outcome.value;
        if (only === undefined) {
          result.skipped.push({ productId: id, name: product.name, reason: 'multiVariant' });
          return;
        }
        if (bundleVariantId === only.id) {
          result.skipped.push({ productId: id, name: product.name, reason: 'bundle' });
          return;
        }
        result.choices.push(toBundleChoice(product, only, 1));
      });
      return result;
    },
    retry: false,
    staleTime: Infinity,
    // A refetch would reseed over the table the operator is editing.
    refetchOnWindowFocus: false,
  });

  const [rows, setRows] = useState<BulkRow[]>([]);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !seed.data) return;
    seeded.current = true;
    setRows(
      seed.data.choices.map((choice) => ({
        choice,
        packText: String(DEFAULT_PACK_SIZE),
        name: null,
        sku: null,
        priceText: null,
        status: 'waiting',
        error: null,
        created: null,
      })),
    );
  }, [seed.data]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [running, setRunning] = useState(false);
  const [masterChoice, setMasterChoice] = useState('');
  const [halted, setHalted] = useState<HaltReason | null>(null);
  const stopRef = useRef(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const [applyAllText, setApplyAllText] = useState(String(DEFAULT_PACK_SIZE));
  /** Catalogue product (by name) already holding a row's SKU; `null` = free. */
  const [taken, setTaken] = useState<Record<string, string | null>>({});
  const onProbe = useCallback((id: string, name: string | null): void => {
    setTaken((current) => (current[id] === name || (name === null && current[id] === undefined) ? current : { ...current, [id]: name }));
  }, []);

  const creators = (targets.data ?? []).filter((target) => target.creationMode !== null);
  const masterId = masterChoice !== '' ? masterChoice : (creators[0]?.connectionId ?? '');
  const masterName = creators.find((target) => target.connectionId === masterId)?.connectionName ?? '';

  const patchRow = (productId: string, patch: Partial<BulkRow>): void => {
    setRows((current) =>
      current.map((row) => (row.choice.productId === productId ? { ...row, ...patch } : row)),
    );
  };

  const isSystemicFailure = (error: ApiError): boolean => {
    const { reason } = readBulkErrorDetails(error.details);
    return reason === 'master-cannot-create-products' || reason === 'master-unavailable' || reason === 'not-synced';
  };

  const failureText = (error: ApiError, stage: 'create' | 'save'): string => {
    const { code, reason, message } = readBulkErrorDetails(error.details);
    if (stage === 'save') {
      if (error.status === 409) return copy.form.saveConflict;
      if (error.status === 400) {
        const why = message ?? reason;
        return why !== null ? interpolate(copy.form.saveInvalidWithReason, { reason: why }) : copy.form.saveInvalid;
      }
      return copy.form.saveFailed;
    }
    if (reason === 'master-cannot-create-products') return interpolate(copy.form.s2CreateCannot, { name: masterName });
    if (reason === 'master-unavailable') return interpolate(copy.form.s2CreateUnavailable, { name: masterName });
    if (reason === 'not-synced') return copy.form.s2CreateNotSynced;
    if (error.status === 422 || code === 'MASTER_REFUSED') {
      return message !== null
        ? interpolate(copy.form.s2CreateFailedWithReason, { name: masterName, reason: message })
        : copy.form.s2CreateFailed;
    }
    return copy.form.s2CreateFailedGeneric;
  };

  const derived = deriveRows(rows);
  const issuesOf = (index: number): { complete: boolean; pack: boolean; dupName: string | null; dupSku: string | null; taken: string | null } => {
    const item = derived[index];
    const row = rows[index];
    return {
      complete: isPackRowValid(item),
      pack: item.pack !== null,
      dupName: item.dupName,
      dupSku: item.dupSku,
      // A product this run made holds its own SKU; only an unmade row can collide.
      taken: row.created === null ? (taken[row.choice.productId] ?? null) : null,
    };
  };
  const rowOk = (index: number): boolean => {
    const issues = issuesOf(index);
    return issues.complete && issues.pack && issues.dupName === null && issues.dupSku === null && issues.taken === null;
  };
  const pending = rows.filter((row) => row.status === 'waiting' || row.status === 'failed');
  const allPendingValid = rows.every((row, index) => (row.status === 'waiting' || row.status === 'failed' ? rowOk(index) : true));
  const failedCount = rows.filter((row) => row.status === 'failed').length;
  const createdCount = rows.filter((row) => row.status === 'created').length;
  const retrying = failedCount > 0 && failedCount === pending.length && createdCount + failedCount === rows.length;

  const run = async (): Promise<void> => {
    if (running || masterId === '') return;
    setRunning(true);
    setHalted(null);
    stopRef.current = false;
    const queue = rowsRef.current
      .filter((row) => row.status === 'waiting' || row.status === 'failed')
      .map((row) => row.choice.productId);
    for (const productId of queue) {
      if (stopRef.current) {
        setHalted('stopped');
        break;
      }
      const index = rowsRef.current.findIndex((item) => item.choice.productId === productId);
      const row = rowsRef.current[index];
      const values = deriveRows(rowsRef.current)[index];
      if (row === undefined || values === undefined || values.pack === null) continue;
      patchRow(productId, { status: 'creating', error: null });
      let stage: 'create' | 'save' = 'create';
      try {
        let created = row.created;
        if (created === null) {
          const made = await createProduct.mutateAsync({
            connectionId: masterId,
            name: values.name.trim(),
            sku: values.sku.trim(),
            price: parsePrice(values.priceText) ?? 0,
            ...(row.choice.currency !== null ? { currency: row.choice.currency } : {}),
            rateSourceVariantId: row.choice.variantId,
          });
          created = { variantId: made.variantId, productId: made.productId };
          patchRow(productId, { created });
        }
        stage = 'save';
        await save.mutateAsync({
          variantId: created.variantId,
          existing: false,
          components: [{ variantId: row.choice.variantId, quantity: values.pack }],
        });
        patchRow(productId, { status: 'created', error: null });
      } catch (error) {
        const failure = error as ApiError;
        patchRow(productId, { status: 'failed', error: failureText(failure, stage) });
        // The same answer would come back for every remaining row: stop instead of repeating it N times.
        if (stage === 'create' && isSystemicFailure(failure)) {
          setHalted('systemic');
          break;
        }
      }
    }
    setRunning(false);
  };

  const applyToAll = (): void => {
    const pack = parsePackSize(applyAllText);
    if (pack === null) return;
    setRows((current) =>
      current.map((row) => (row.created === null && row.status !== 'created' ? { ...row, packText: String(pack) } : row)),
    );
  };

  if (seed.isPending) {
    return <p role="status">{copy.bulk.loading}</p>;
  }
  if (seed.isError) {
    return <Alert tone="error">{copy.bulk.loadFailed}</Alert>;
  }

  const skipped = seed.data.skipped;
  const lookupFailures = skipped.filter((item) => item.reason === 'notFound');
  const collapseFailures = lookupFailures.length > SKIP_COLLAPSE_ABOVE;
  const shownSkipped = collapseFailures ? skipped.filter((item) => item.reason !== 'notFound') : skipped;
  const capped = productIds.length > MAX_BULK_ROWS;
  const noShop = targets.isSuccess && creators.length === 0;
  const submitLabel = running
    ? interpolate(copy.bulk.running, { done: format.number(createdCount), total: format.number(rows.length) })
    : retrying
      ? interpolate(copy.bulk.retry, { n: format.number(failedCount) })
      : interpolate(copy.bulk.submit, { n: format.number(pending.length) });
  const allDone = rows.length > 0 && createdCount === rows.length;
  const canSubmit = write.canWrite && !running && masterId !== '' && pending.length > 0 && allPendingValid;
  const packHintText = interpolate(copy.bulk.packHint, { min: String(MIN_PACK_SIZE), max: String(MAX_PACK_SIZE) });

  // Enter walks down the same column, so hundreds of quantities are fixed without the mouse.
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>, index: number, field: string): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if ((event.ctrlKey || event.metaKey) && canSubmit) {
      void run();
      return;
    }
    const next = tableRef.current?.querySelector<HTMLInputElement>(`[data-field="${field}"][data-index="${String(index + 1)}"]`);
    if (next !== null && next !== undefined && !next.disabled) {
      next.focus();
      next.select();
    }
  };

  return (
    <div className="bulk-pack" data-testid="bulk-multipack">
      <header className="bulk-pack__head">
        <h1 className="bulk-pack__title">{copy.bulk.title}</h1>
        <p className="bulk-pack__lead">{copy.bulk.intro}</p>
      </header>

      {!write.canWrite ? <Alert tone="info">{copy.bulk.noWrite}</Alert> : null}
      {noShop ? <Alert tone="warning">{copy.bulk.noShop}</Alert> : null}
      {targets.isError ? <Alert tone="error">{copy.bulk.targetsFailed}</Alert> : null}

      {creators.length > 1 ? (
        <label className="bulk-pack__shop">
          <span>{copy.bulk.shop}</span>
          <select
            className="input"
            value={masterId}
            disabled={running}
            onChange={(event) => setMasterChoice(event.target.value)}
          >
            {creators.map((target) => (
              <option key={target.connectionId} value={target.connectionId}>
                {target.connectionName}
              </option>
            ))}
          </select>
        </label>
      ) : creators.length === 1 ? (
        <p className="bulk-pack__shop">
          {copy.bulk.shop}: <strong>{masterName}</strong>
        </p>
      ) : null}

      {capped ? (
        <Alert tone="info">{interpolate(copy.bulk.capped, { max: format.number(MAX_BULK_ROWS), total: format.number(productIds.length) })}</Alert>
      ) : null}

      {skipped.length > 0 ? (
        <Alert tone="warning" title={copy.bulk.skippedTitle} data-testid="bulk-skipped">
          <ul className="bulk-pack__skipped">
            {shownSkipped.map((item) => (
              <li key={item.productId}>
                <strong>{item.name}</strong>: {copy.bulk.skipReason[item.reason]}
              </li>
            ))}
            {collapseFailures ? (
              <li>{interpolate(copy.bulk.skippedMany, { n: format.number(lookupFailures.length) })}</li>
            ) : null}
          </ul>
        </Alert>
      ) : null}

      {rows.length > 1 && write.canWrite ? (
        <div className="bulk-pack__all">
          <label htmlFor="bulk-apply-all">{copy.bulk.applyAllLabel}</label>
          <Input
            id="bulk-apply-all"
            type="number"
            inputMode="numeric"
            min={MIN_PACK_SIZE}
            max={MAX_PACK_SIZE}
            value={applyAllText}
            disabled={running}
            invalid={parsePackSize(applyAllText) === null}
            onChange={(event) => setApplyAllText(event.target.value)}
          />
          <Button tone="secondary" disabled={running || parsePackSize(applyAllText) === null} onClick={applyToAll}>
            {copy.bulk.applyAll}
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p>{copy.bulk.noRows}</p>
      ) : (
        <div className="bulk-pack__scroll">
          <table className="bulk-pack__table" ref={tableRef}>
            <thead>
              <tr>
                <th scope="col">{copy.bulk.colProduct}</th>
                <th scope="col">{copy.bulk.colPack}</th>
                <th scope="col">{copy.bulk.colName}</th>
                <th scope="col">{copy.bulk.colSku}</th>
                <th scope="col">{copy.bulk.colPrice}</th>
                <th scope="col">{copy.bulk.colStatus}</th>
                <th scope="col">
                  <span className="sr-only">{copy.bulk.colRemove}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const values = derived[index];
                const issues = issuesOf(index);
                const locked = running || !write.canWrite || row.status === 'creating' || row.status === 'created' || row.created !== null;
                const id = row.choice.productId;
                const unitPrice = row.choice.price;
                const message =
                  row.status !== 'waiting' && row.status !== 'failed'
                    ? null
                    : !issues.pack
                      ? packHintText
                      : issues.dupSku !== null
                        ? interpolate(copy.bulk.dupSku, { name: issues.dupSku })
                        : issues.taken !== null
                          ? interpolate(copy.bulk.skuTaken, { name: issues.taken })
                          : issues.dupName !== null
                            ? interpolate(copy.bulk.dupName, { name: issues.dupName })
                            : !issues.complete && row.status === 'waiting'
                              ? copy.bulk.rowIncomplete
                              : null;
                return (
                  <tr key={id} className={`bulk-pack__row bulk-pack__row--${row.status}`} data-testid={`bulk-row-${id}`}>
                    <th scope="row" className="bulk-pack__product">
                      <span>{row.choice.name}</span>
                      <small>{row.choice.sku ?? ''}</small>
                    </th>
                    <td data-label={copy.bulk.colPack}>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={MIN_PACK_SIZE}
                        max={MAX_PACK_SIZE}
                        value={row.packText}
                        disabled={locked}
                        invalid={!issues.pack}
                        data-field="pack"
                        data-index={index}
                        aria-label={interpolate(copy.bulk.packAria, { name: row.choice.name })}
                        onChange={(event) => patchRow(id, { packText: event.target.value })}
                        onKeyDown={(event) => onFieldKey(event, index, 'pack')}
                        onFocus={(event) => event.target.select()}
                      />
                    </td>
                    <td data-label={copy.bulk.colName}>
                      <Input
                        value={values.name}
                        title={values.name}
                        disabled={locked}
                        invalid={issues.dupName !== null}
                        data-field="name"
                        data-index={index}
                        aria-label={copy.bulk.colName}
                        onChange={(event) => patchRow(id, { name: event.target.value })}
                        onKeyDown={(event) => onFieldKey(event, index, 'name')}
                      />
                    </td>
                    <td data-label={copy.bulk.colSku}>
                      <Input
                        value={values.sku}
                        disabled={locked}
                        invalid={values.sku.trim() === '' || issues.dupSku !== null || issues.taken !== null}
                        placeholder={copy.bulk.skuMissing}
                        data-field="sku"
                        data-index={index}
                        aria-label={copy.bulk.colSku}
                        onChange={(event) => patchRow(id, { sku: event.target.value })}
                        onKeyDown={(event) => onFieldKey(event, index, 'sku')}
                      />
                      <SkuProbe id={id} sku={values.sku} enabled={row.created === null && row.status !== 'created'} onResult={onProbe} />
                    </td>
                    <td data-label={copy.bulk.colPrice}>
                      <Input
                        inputMode="decimal"
                        value={values.priceText}
                        disabled={locked}
                        invalid={parsePrice(values.priceText) === null}
                        data-field="price"
                        data-index={index}
                        aria-label={copy.bulk.colPrice}
                        onChange={(event) => patchRow(id, { priceText: event.target.value })}
                        onKeyDown={(event) => onFieldKey(event, index, 'price')}
                      />
                      {unitPrice !== null ? (
                        <small className="bulk-pack__hint">
                          {interpolate(copy.bulk.unitPrice, { price: format.money(unitPrice, row.choice.currency ?? undefined) })}
                        </small>
                      ) : null}
                    </td>
                    <td data-label={copy.bulk.colStatus}>
                      <span className={`bulk-pack__status bulk-pack__status--${row.status}`}>
                        {copy.bulk.status[row.status]}
                      </span>
                      {row.created !== null && row.status !== 'created' ? (
                        <small className="bulk-pack__badge">{copy.bulk.createdUnsaved}</small>
                      ) : null}
                      {row.status === 'failed' && row.error !== null ? (
                        <small className="bulk-pack__error">{row.error}</small>
                      ) : null}
                      {row.status === 'created' && row.created !== null ? (
                        <Link className="bulk-pack__open" to={`/products/bundles/${encodeURIComponent(row.created.variantId)}`}>
                          {copy.bulk.open}
                        </Link>
                      ) : null}
                      {message !== null ? <small className="bulk-pack__error">{message}</small> : null}
                    </td>
                    <td className="bulk-pack__remove-cell">
                      {row.status !== 'created' ? (
                        <button
                          type="button"
                          className="bulk-pack__remove"
                          disabled={running}
                          aria-label={interpolate(copy.bulk.removeAria, { name: row.choice.name })}
                          onClick={() => setRows((current) => current.filter((item) => item.choice.productId !== id))}
                        >
                          &times;
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {running ? interpolate(copy.bulk.running, { done: format.number(createdCount), total: format.number(rows.length) }) : ''}
      </p>
      {halted === 'systemic' && !running ? <Alert tone="warning">{copy.bulk.systemicStopped}</Alert> : null}
      {halted === 'stopped' && !running ? <Alert tone="info">{copy.bulk.stopped}</Alert> : null}
      {failedCount > 0 && !running ? <Alert tone="error">{copy.bulk.partial}</Alert> : null}
      {allDone ? (
        <Alert tone="success">
          {interpolate(copy.bulk.allDone, { n: format.number(createdCount) })}{' '}
          <Link to="/products">{copy.bulk.backToProducts}</Link>
        </Alert>
      ) : null}

      <div className="bulk-pack__actions">
        <Link className="button button--ghost" to="/products">
          {copy.bulk.cancel}
        </Link>
        {running ? (
          <Button tone="secondary" onClick={() => { stopRef.current = true; }} data-testid="bulk-stop">
            {copy.bulk.stop}
          </Button>
        ) : null}
        <Button
          tone="primary"
          disabled={!canSubmit}
          onClick={() => void run()}
          data-testid="bulk-submit"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

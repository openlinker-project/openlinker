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
import { useEffect, useRef, useState, type ReactElement } from 'react';
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
import { toBundleChoice, type BundleProductChoice } from '../lib/bundle-choice';
import {
  DEFAULT_PACK_SIZE,
  MAX_PACK_SIZE,
  MIN_PACK_SIZE,
  clampPackSize,
  isPackRowValid,
  packName,
  packPriceText,
  packSku,
  readBulkErrorDetails,
  type BulkRowStatus,
} from '../lib/bundle-bulk-model';
import { parsePrice } from '../lib/bundle-form-model';
import { useBundleCreationTargetsQuery } from '../hooks/use-bundle-queries';
import { useCreateBundleProductMutation } from '../hooks/use-create-bundle-product-mutation';
import { useSaveBundleMutation } from '../hooks/use-save-bundle-mutation';

export interface BundleBulkCreatorProps {
  productIds: readonly string[];
}

type SkipReason = 'multiVariant' | 'bundle' | 'notFound';

interface SkippedProduct {
  productId: string;
  name: string;
  reason: SkipReason;
}

interface SeedResult {
  choices: BundleProductChoice[];
  skipped: SkippedProduct[];
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

function effectiveOf(row: BulkRow): { pack: number; name: string; sku: string; priceText: string } {
  const pack = clampPackSize(row.packText);
  return {
    pack,
    name: row.name ?? packName(row.choice.name, pack),
    sku: row.sku ?? packSku(row.choice.sku, pack),
    priceText: row.priceText ?? packPriceText(row.choice.price, pack),
  };
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
      const settled = await Promise.allSettled(productIds.map((id) => apiClient.products.getById(id)));
      const result: SeedResult = { choices: [], skipped: [] };
      settled.forEach((outcome, index) => {
        const id = productIds[index] ?? '';
        if (outcome.status !== 'fulfilled') {
          result.skipped.push({ productId: id, name: id, reason: 'notFound' });
          return;
        }
        const product = outcome.value;
        const variants = product.variants ?? [];
        const only = variants.length === 1 ? variants[0] : undefined;
        if (only === undefined) {
          result.skipped.push({ productId: id, name: product.name, reason: 'multiVariant' });
          return;
        }
        const choice = toBundleChoice(product, only, 1);
        if (choice.isBundle) result.skipped.push({ productId: id, name: product.name, reason: 'bundle' });
        else result.choices.push(choice);
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

  const creators = (targets.data ?? []).filter((target) => target.creationMode !== null);
  const masterId = masterChoice !== '' ? masterChoice : (creators[0]?.connectionId ?? '');
  const masterName = creators.find((target) => target.connectionId === masterId)?.connectionName ?? '';

  const patchRow = (productId: string, patch: Partial<BulkRow>): void => {
    setRows((current) =>
      current.map((row) => (row.choice.productId === productId ? { ...row, ...patch } : row)),
    );
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

  const pending = rows.filter((row) => row.status === 'waiting' || row.status === 'failed');
  const allPendingValid = pending.every((row) => isPackRowValid(effectiveOf(row)));
  const failedCount = rows.filter((row) => row.status === 'failed').length;
  const createdCount = rows.filter((row) => row.status === 'created').length;
  const retrying = failedCount > 0 && failedCount === pending.length && createdCount + failedCount === rows.length;

  const run = async (): Promise<void> => {
    if (running || masterId === '') return;
    setRunning(true);
    const queue = rowsRef.current
      .filter((row) => row.status === 'waiting' || row.status === 'failed')
      .map((row) => row.choice.productId);
    for (const productId of queue) {
      const row = rowsRef.current.find((item) => item.choice.productId === productId);
      if (row === undefined) continue;
      const values = effectiveOf(row);
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
        patchRow(productId, { status: 'failed', error: failureText(error as ApiError, stage) });
      }
    }
    setRunning(false);
  };

  if (seed.isPending) {
    return <p role="status">{copy.bulk.loading}</p>;
  }
  if (seed.isError) {
    return <Alert tone="error">{copy.bulk.loadFailed}</Alert>;
  }

  const skipped = seed.data.skipped;
  const noShop = targets.isSuccess && creators.length === 0;
  const submitLabel = running
    ? interpolate(copy.bulk.running, { done: format.number(createdCount), total: format.number(rows.length) })
    : retrying
      ? interpolate(copy.bulk.retry, { n: format.number(failedCount) })
      : interpolate(copy.bulk.submit, { n: format.number(pending.length) });
  const allDone = rows.length > 0 && createdCount === rows.length;

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

      {skipped.length > 0 ? (
        <Alert tone="warning" title={copy.bulk.skippedTitle} data-testid="bulk-skipped">
          <ul className="bulk-pack__skipped">
            {skipped.map((item) => (
              <li key={item.productId}>
                <strong>{item.name}</strong>: {copy.bulk.skipReason[item.reason]}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <p>{copy.bulk.noRows}</p>
      ) : (
        <div className="bulk-pack__scroll">
          <table className="bulk-pack__table">
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
              {rows.map((row) => {
                const values = effectiveOf(row);
                const locked = running || row.status === 'creating' || row.status === 'created';
                const invalid = !isPackRowValid(values);
                const id = row.choice.productId;
                return (
                  <tr key={id} className={`bulk-pack__row bulk-pack__row--${row.status}`} data-testid={`bulk-row-${id}`}>
                    <th scope="row" className="bulk-pack__product">
                      <span>{row.choice.name}</span>
                      <small>{row.choice.sku ?? ''}</small>
                    </th>
                    <td>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={MIN_PACK_SIZE}
                        max={MAX_PACK_SIZE}
                        value={row.packText}
                        disabled={locked}
                        aria-label={interpolate(copy.bulk.packAria, { name: row.choice.name })}
                        onChange={(event) => patchRow(id, { packText: event.target.value })}
                        onBlur={() => patchRow(id, { packText: String(clampPackSize(row.packText)) })}
                      />
                    </td>
                    <td>
                      <Input
                        value={values.name}
                        disabled={locked}
                        aria-label={copy.bulk.colName}
                        onChange={(event) => patchRow(id, { name: event.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        value={values.sku}
                        disabled={locked}
                        invalid={values.sku.trim() === ''}
                        placeholder={copy.bulk.skuMissing}
                        aria-label={copy.bulk.colSku}
                        onChange={(event) => patchRow(id, { sku: event.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        inputMode="decimal"
                        value={values.priceText}
                        disabled={locked}
                        invalid={parsePrice(values.priceText) === null}
                        aria-label={copy.bulk.colPrice}
                        onChange={(event) => patchRow(id, { priceText: event.target.value })}
                      />
                    </td>
                    <td aria-live="polite">
                      <span className={`bulk-pack__status bulk-pack__status--${row.status}`}>
                        {copy.bulk.status[row.status]}
                      </span>
                      {row.status === 'failed' && row.error !== null ? (
                        <small className="bulk-pack__error">{row.error}</small>
                      ) : null}
                      {row.status === 'created' && row.created !== null ? (
                        <Link className="bulk-pack__open" to={`/products/bundles/${encodeURIComponent(row.created.variantId)}`}>
                          {copy.bulk.open}
                        </Link>
                      ) : null}
                      {row.status === 'waiting' && invalid ? (
                        <small className="bulk-pack__error">{copy.bulk.rowIncomplete}</small>
                      ) : null}
                    </td>
                    <td>
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
        <Button
          tone="primary"
          disabled={
            !write.canWrite || running || masterId === '' || pending.length === 0 || !allPendingValid
          }
          onClick={() => void run()}
          data-testid="bulk-submit"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

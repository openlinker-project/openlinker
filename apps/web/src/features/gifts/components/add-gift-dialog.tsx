/**
 * AddGiftDialog (#3940, mockup M31 `order/add-gift*`)
 *
 * An operator adds a gift to an order by hand: the product, the quantity and how
 * the document shows it. Allowed until the parcel is closed; after that the
 * dialog says so and offers nothing to submit. When a sales document already
 * exists ONE warning says it will not show the gift, and the add still goes
 * ahead: the document is the operator's to correct.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { formatAmount } from '../../../shared/format/format-amount';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';
import { BundleProductPicker, type BundleProductChoice } from '../../bundles';
import { GiftFormOptions, type GiftFormOptionValue } from '../../gift-documents/components/gift-form-options';
import {
  GiftDocumentFormChoiceValues,
  isGiftUnitPriceAmount,
  type GiftDocumentFormChoice,
} from '../../gift-documents/lib/gift-lines';
import {
  readGiftConnectionOverride,
  resolveGiftDocumentForm,
  useGiftDocumentSettingsQuery,
} from '../../gift-documents';
import { useConnectionsQuery } from '../../connections';
import { useDocumentProvidersQuery } from '../../gift-documents/hooks/use-gift-documents-queries';
import { zeroAvailability } from '../../gift-documents/lib/zero-availability';
import { useAddGiftMutation } from '../hooks/use-gift-rules';
import { giftCostText, readGiftCost } from '../lib/gift-cost';
import { readAddGiftRefusal } from '../lib/gift-refusal';

export interface AddGiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  internalOrderId: string;
  /** Order number for the title. */
  orderLabel: string;
  currency?: string;
  /** The parcel is already packed or shipped: nothing can be added. */
  parcelClosed: boolean;
  /** The order has not finished importing (its products are not matched yet). */
  notReady?: boolean;
  /** A sales document already exists for the order. */
  hasSalesDocument: boolean;
  /** The connection issuing the order's sales document, once there is one (#3935). */
  documentConnectionId?: string | null;
}

export function AddGiftDialog({
  open,
  onOpenChange,
  internalOrderId,
  orderLabel,
  currency,
  parcelClosed,
  notReady = false,
  hasSalesDocument,
  documentConnectionId = null,
}: AddGiftDialogProps): ReactElement {
  const copy = useMessages('gifts');
  const apiClient = useApiClient();
  const { showToast } = useToast();
  const mutation = useAddGiftMutation(internalOrderId);
  const [choice, setChoice] = useState<BundleProductChoice | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [form, setForm] = useState<GiftFormOptionValue>('inherit');
  const [customAmount, setCustomAmount] = useState('');
  const providers = useDocumentProvidersQuery();
  // The card "as in settings" names the form the settings actually resolve to for
  // this order: the issuing channel's own choice, else the install default.
  const documentSettings = useGiftDocumentSettingsQuery();
  const connections = useConnectionsQuery(undefined, { enabled: documentConnectionId !== null });
  const documentConnection = connections.data?.find((c) => c.id === documentConnectionId);
  const resolvedForm = resolveGiftDocumentForm(
    undefined,
    readGiftConnectionOverride(documentConnection?.config),
    documentSettings.data?.giftDocumentForm,
  ).form;
  const inheritedForm = (GiftDocumentFormChoiceValues as readonly string[]).includes(resolvedForm)
    ? (resolvedForm as GiftDocumentFormChoice)
    : undefined;
  const zero = zeroAvailability(providers.data?.providers);
  const documentsCopy = useMessages('gift-documents');
  const zeroReason = zero.available
    ? null
    : zero.refusingProviderName
      ? interpolate(documentsCopy.connection.zeroNotOffered, { provider: zero.refusingProviderName })
      : documentsCopy.connection.zeroNoProvider;

  const { reset } = mutation;
  useEffect(() => {
    if (open) {
      setChoice(null);
      setQuantity('1');
      setForm('inherit');
      setCustomAmount('');
      reset();
    }
  }, [open, reset]);

  const costs = useQuery({
    queryKey: ['gifts', 'variant-cost', choice?.productId ?? ''],
    queryFn: () => apiClient.products.getVariantCosts(choice?.productId ?? ''),
    enabled: choice !== null,
  });
  const giftCost = readGiftCost({
    status: costs.status,
    costs: costs.data,
    variantId: choice?.variantId,
    currency,
  });
  const qty = Number(quantity);
  const validQuantity = Number.isInteger(qty) && qty > 0;

  const refusal = mutation.isError ? readAddGiftRefusal(mutation.error) : null;
  const unready = notReady || refusal?.kind === 'not-ready';
  const closed = parcelClosed || refusal?.kind === 'parcel-closed' || unready;
  const normalizedAmount = customAmount.trim().replace(',', '.');
  const customOk = form !== 'custom-price' || isGiftUnitPriceAmount(normalizedAmount);
  const canSubmit = !closed && choice !== null && validQuantity && customOk && !mutation.isPending;

  const submit = (): void => {
    if (choice === null || !validQuantity) return;
    mutation.mutate(
      {
        variantId: choice.variantId,
        quantity: qty,
        ...(form !== 'inherit' && { documentForm: form }),
        ...(form === 'custom-price' && { documentUnitPrice: normalizedAmount }),
      },
      {
        onSuccess: (result) => {
          showToast({
            tone: result.gift?.salesDocumentExists ? 'warning' : 'success',
            title: copy.addDialog.added,
            description:
              result.gift?.onPickList === false
                ? copy.addDialog.notOnPickList
                : result.gift?.salesDocumentExists
                  ? copy.addDialog.documentWarning
                  : copy.addDialog.addedBody,
          });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="order-gift-dialog">
        <div>
          <DialogTitle>{interpolate(copy.addDialog.title, { order: orderLabel })}</DialogTitle>
          <DialogDescription>{copy.addDialog.description}</DialogDescription>

          {unready ? (
            <Alert tone="error" title={copy.addDialog.notReadyTitle} data-testid="order-gift-dialog-refused-not-ready">
              {copy.addDialog.notReadyBody}
            </Alert>
          ) : closed ? (
            <Alert tone="error" title={copy.addDialog.closedTitle} data-testid="order-gift-dialog-refused-closed">
              {copy.addDialog.closedBody}
            </Alert>
          ) : hasSalesDocument ? (
            <Alert tone="warning" title={copy.addDialog.documentTitle} data-testid="order-gift-dialog-warning-document">
              {copy.addDialog.documentWarning}
            </Alert>
          ) : null}

          {refusal?.kind === 'other' ? (
            <Alert tone="error" data-testid="order-gift-dialog-error">
              {refusal.message}
            </Alert>
          ) : null}

          <div className="gift-dialog__fields">
            <div data-testid="order-gift-dialog-product">
              {choice === null ? (
                <BundleProductPicker
                  label={copy.addDialog.product}
                  placeholder={copy.addDialog.productPlaceholder}
                  disabled={closed}
                  onPick={setChoice}
                  testIdPrefix="order-gift-dialog-search"
                />
              ) : (
                <div className="gift-picked">
                  <span className="form-field__label">{copy.addDialog.product}</span>
                  <p>
                    <strong>{choice.name}</strong>{' '}
                    <span className="mono-text text-muted">{choice.sku ?? ''}</span>
                  </p>
                  <Button tone="secondary" onClick={() => setChoice(null)}>
                    {copy.addDialog.changeProduct}
                  </Button>
                </div>
              )}
            </div>

            <label className="form-field__label" htmlFor="order-gift-dialog-qty">
              {copy.addDialog.quantity}
            </label>
            <Input
              id="order-gift-dialog-qty"
              data-testid="order-gift-dialog-qty"
              type="number"
              min={1}
              value={quantity}
              disabled={closed}
              onChange={(event) => setQuantity(event.target.value)}
            />

            <span className="form-field__label">{copy.addDialog.onDocument}</span>
            <GiftFormOptions
              name="order-gift-dialog-doc-form"
              value={form}
              disabled={closed}
              inheritedForm={inheritedForm}
              inheritedUnknown={inheritedForm === undefined}
              zeroAvailable={zero.available}
              zeroReason={zeroReason}
              onChange={setForm}
              customPrice={{
                amount: customAmount,
                onAmountChange: setCustomAmount,
                currency: currency ?? '',
                label: copy.addDialog.customPriceLabel,
              }}
            />

            <p className="text-muted" data-testid="order-gift-dialog-reason">
              {copy.addDialog.reason}
            </p>
            {choice !== null ? (
              <p data-testid="order-gift-dialog-cost">
                {interpolate(copy.order.customerPays, { price: formatAmount(0, currency) })}
                {' · '}
                {giftCostText(
                  giftCost,
                  copy.cost,
                  {
                    known: (unitCost) =>
                      validQuantity
                        ? interpolate(copy.order.costsYou, { cost: formatAmount(unitCost * qty, currency) })
                        : copy.order.costUnknown,
                    none: copy.order.costUnknown,
                  },
                  (template, costCurrency) => interpolate(template, { currency: costCurrency }),
                )}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" tone="secondary" data-testid="order-gift-dialog-cancel">
              {copy.addDialog.cancel}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!canSubmit}
            data-testid="order-gift-dialog-submit"
            onClick={submit}
          >
            {copy.addDialog.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

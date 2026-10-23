/**
 * eparagony.pl Setup Form (#1911)
 *
 * Guided wizard for creating an eparagony.pl (Fiscalization) connection.
 * Three things this surface must get right, per ADR-042 and the issue's
 * acceptance criteria:
 *
 *   1. Preconditions are named up front, and the panel is honest about which
 *      it can and cannot check. The device-configured-for-e-receipts step is
 *      never OpenLinker's to verify - it is a `serwisant` job - and the
 *      sandbox reports every device as a constant `INACTIVE` stub, so a
 *      "reachable" check there would be misleading, not merely unavailable.
 *   2. A failed save is diagnosable per FIELD, not just "save failed" - the
 *      shape validators return `{ message, errors: [{ path, message }] }`
 *      (docs/architecture-overview.md - connection config/credentials shape
 *      validation), and this form maps that onto the matching `FormField`.
 *   3. Copy never implies a legal receipt obligation or that connecting
 *      makes the seller compliant (spec risk R5), and never promises
 *      automatic registration - v1 registers only on an explicit operator
 *      action on the order (#1908, #1909).
 *
 *   4. The connection does what the operator connected it for (#3769). The
 *      operator picks the documents up front - e-receipts, invoices or both -
 *      and each choice shows the fields that make it work, so an invoicing
 *      connection cannot be created without the seller tax number every
 *      invoice needs. What still has to happen after creation (a numbering
 *      series, a sales-document rule) is said on the created state rather
 *      than discovered as a refused invoice.
 *
 * Approved mockup: `docs/plans/mockups/eparagony-document-choice.html`.
 *
 * @module features/connections/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  useCreateConnectionMutation,
  useTestConnectionMutation,
  type ConnectionTestResult,
} from '../../../features/connections';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../../shared/api/api-error';
import {
  EPARAGONY_ADDRESS_PART_REQUIRED_MESSAGE,
  EPARAGONY_SELLER_ADDRESS_REQUIRED_FIELDS,
  EPARAGONY_SETUP_DEFAULT_VALUES,
  EparagonyDocumentCapabilityValues,
  eparagonySetupSchema,
  orderDocumentCapabilities,
  toCreateConnectionInput,
  type EparagonyDocumentCapability,
  type EparagonySetupFormSubmission,
  type EparagonySetupFormValues,
} from './eparagony-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FieldError } from '../../../shared/ui/field-error';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { StatusBadge } from '../../../shared/ui/status-badge';

const DOCUMENT_CHOICES: readonly {
  capability: EparagonyDocumentCapability;
  label: string;
  help: string;
}[] = [
  {
    capability: 'Fiscalization',
    label: 'Fiscal e-receipts',
    help: 'Registers a sale on your own fiscal printer through eparagony.pl.',
  },
  {
    capability: 'Invoicing',
    label: 'Invoices',
    help: 'Issues VAT invoices through eparagony.pl. eparagony.pl can also send them on to KSeF.',
  },
];

/** One summary line for the whole address, rather than one "Required." per empty part. */
const ADDRESS_SUMMARY_MESSAGE = 'Complete the seller address, or leave it empty.';

const KNOWN_FIELDS = new Set([
  'name',
  'clientId',
  'clientSecret',
  'integrationId',
  'posId',
  'environment',
  'enabledCapabilities',
  'merchantTIN',
  'merchantName',
  'merchantAddress',
  'eInvoicingHubEnabled',
]);

interface EparagonySetupFormProps {
  /** Lets the page keep its header chips in step with the document choice. */
  onDocumentCapabilitiesChange?: (capabilities: EparagonyDocumentCapability[]) => void;
}

interface FlatValidationIssue {
  path: string;
  message: string;
}

/** Maps a shape-validator 400's `{ message, errors }` body onto the field(s)
 *  it names. Unknown paths and non-structured errors fall through to the
 *  top-level Alert instead of being silently dropped. */
function resolveFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || error.details === null) {
    return {};
  }
  const body = error.details as { errors?: unknown };
  if (!Array.isArray(body.errors)) {
    return {};
  }
  const byField: Record<string, string> = {};
  for (const issue of body.errors as FlatValidationIssue[]) {
    if (typeof issue?.path === 'string' && typeof issue?.message === 'string') {
      byField[issue.path] = issue.message;
    }
  }
  return byField;
}

export function EparagonySetupForm({
  onDocumentCapabilitiesChange,
}: EparagonySetupFormProps = {}): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const navigate = useNavigate();
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [createdCapabilities, setCreatedCapabilities] = useState<EparagonyDocumentCapability[]>(
    [],
  );

  const form = useForm<EparagonySetupFormValues, undefined, EparagonySetupFormSubmission>({
    defaultValues: EPARAGONY_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(eparagonySetupSchema),
    mode: 'onBlur',
  });

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!form.formState.isDirty || createdConnectionId !== null) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [form.formState.isDirty, createdConnectionId]);

  const errors = form.formState.errors;
  const selected = orderDocumentCapabilities(form.watch('enabledCapabilities') ?? []);
  const issuesReceipts = selected.includes('Fiscalization');
  const issuesInvoices = selected.includes('Invoicing');
  const selectionKey = selected.join(',');

  useEffect(() => {
    onDocumentCapabilitiesChange?.(orderDocumentCapabilities(selectionKey.split(',')));
  }, [selectionKey, onDocumentCapabilitiesChange]);

  // The address parts each carry a bare "Required." inline, which reads as
  // nothing in a summary at the top of the page - so they collapse into one
  // sentence there, naming the whole address.
  const hasAddressError = EPARAGONY_SELLER_ADDRESS_REQUIRED_FIELDS.some(
    (field) => errors[field] !== undefined,
  );
  const validationMessages = [
    ...Object.values(errors).flatMap((error) =>
      error?.message && error.message !== EPARAGONY_ADDRESS_PART_REQUIRED_MESSAGE
        ? [String(error.message)]
        : [],
    ),
    ...(hasAddressError ? [ADDRESS_SUMMARY_MESSAGE] : []),
  ];

  // Server-side, per-field diagnosis (#1911 AC): a shape-validation 400 names
  // WHICH field or precondition is the problem rather than a generic failure.
  const fieldErrors = useMemo(
    () => resolveFieldErrors(createConnection.error),
    [createConnection.error],
  );
  const unmatchedServerErrors = useMemo(() => {
    if (!(createConnection.error instanceof ApiError)) return [];
    return Object.entries(fieldErrors)
      .filter(([path]) => !KNOWN_FIELDS.has(path))
      .map(([path, message]) => `${path}: ${message}`);
  }, [createConnection.error, fieldErrors]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      setCreatedConnectionId(created.id);
      setCreatedCapabilities(orderDocumentCapabilities(values.enabledCapabilities));
      // No toast: the created state below says the same thing in place, and
      // a second "Connection created" on screen would only repeat it.
    } catch {
      return;
    }
  });

  const onTest = async (): Promise<void> => {
    if (!createdConnectionId) return;
    setTestResult(null);
    try {
      const result = await testConnection.mutateAsync(createdConnectionId);
      setTestResult(result);
    } catch {
      // surfaced via testConnection.error
    }
  };


  const serverError = (field: string): string | undefined => fieldErrors[field];

  if (createdConnectionId) {
    const createdInvoices = createdCapabilities.includes('Invoicing');
    const createdBoth = createdCapabilities.length === EparagonyDocumentCapabilityValues.length;
    return (
      <div className="wizard-card" data-testid="eparagony-setup-created">
        <Alert tone="success" title="Connection created">
          eparagony.pl connection &ldquo;{form.getValues('name').trim()}&rdquo; was created
          {createdInvoices ? ' with the seller details invoices need.' : '.'}
        </Alert>

        {/*
          Both are requirements the connection itself cannot carry, and each
          fails later as a refused or held document rather than as anything on
          this page - so they are named here, while the operator is still in
          the setup flow (#3769).
        */}
        {createdInvoices ? (
          <Alert tone="warning" title="Before the first invoice">
            <ul className="next-steps">
              <li>
                <span>
                  Set up an invoice numbering series. Without one, issuing an invoice stops and
                  asks for it.
                </span>
                <Link to={`/connections/${createdConnectionId}/numbering`}>Set up numbering</Link>
              </li>
              {createdBoth ? (
                <li>
                  <span>Add a sales-document rule: which orders get a receipt, which an invoice.</span>
                  <Link to="/settings/sales-documents">Open sales documents</Link>
                </li>
              ) : null}
            </ul>
          </Alert>
        ) : null}

        {testResult ? (
          <Alert
            tone={testResult.success ? 'success' : 'error'}
            title={testResult.success ? 'Connection test passed' : 'Connection test failed'}
          >
            {testResult.message}
            {typeof testResult.latencyMs === 'number' ? ` (${testResult.latencyMs}ms)` : null}
          </Alert>
        ) : null}
        {testConnection.error ? (
          <Alert tone="error" title="Unable to test connection">
            {testConnection.error.message}
          </Alert>
        ) : null}
        <div className="form-actions">
          <Button type="button" onClick={() => void onTest()} disabled={testConnection.isPending}>
            {testConnection.isPending ? 'Testing…' : 'Test connection'}
          </Button>
          <Button tone="secondary" type="button" onClick={() => void navigate('/connections')}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const choiceError = errors.enabledCapabilities?.message;

  return (
    <form className="wizard-card" onSubmit={(event) => void onSubmit(event)} noValidate>
      <BackLink to="/connections/new" label="Connections" className="wizard-card__back" />

      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}
      {createConnection.error ? (
        <Alert tone="error" title="Unable to create connection">
          {createConnection.error.message}
          {unmatchedServerErrors.length > 0 ? (
            <ul>
              {unmatchedServerErrors.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <fieldset
        className={['capability-fieldset', choiceError ? 'capability-fieldset--invalid' : '']
          .filter(Boolean)
          .join(' ')}
        aria-describedby={
          choiceError ? 'eparagony-document-choice-help eparagony-document-choice-error' : 'eparagony-document-choice-help'
        }
      >
        <legend className="capability-fieldset__legend">What should this connection issue?</legend>
        <p className="muted-text capability-fieldset__help" id="eparagony-document-choice-help">
          Pick one or both. You can change this later on the connection&rsquo;s detail page.
        </p>
        <ul className="capability-list">
          {DOCUMENT_CHOICES.map((choice) => {
            const id = `new-cap-${choice.capability}`;
            return (
              <li key={choice.capability} className="capability-list__item">
                <label htmlFor={id} className="capability-list__label">
                  <input
                    id={id}
                    type="checkbox"
                    value={choice.capability}
                    {...form.register('enabledCapabilities')}
                  />
                  <span className="capability-list__name">{choice.label}</span>
                  <span className="capability-list__code">{choice.capability}</span>
                </label>
                <p className="capability-list__help muted-text">{choice.help}</p>
              </li>
            );
          })}
        </ul>
        <FieldError id="eparagony-document-choice-error" message={choiceError} />
      </fieldset>

      {issuesReceipts && issuesInvoices ? (
        <Alert tone="info" density="compact">
          An order gets one document, never both. After connecting, add a rule in Settings → Sales
          documents that says which orders get a receipt and which get an invoice. Until then, orders
          wait instead of getting a guessed document.
        </Alert>
      ) : null}

      <div className="setup-lane">
        <h3 className="setup-lane__title">eparagony.pl account</h3>
        <FormField
          label="Connection name"
          name="name"
          error={errors.name?.message ?? serverError('name')}
          description="A label to identify this eparagony.pl account in OpenLinker."
        >
          <Input
            {...form.register('name')}
            placeholder="My eparagony.pl account"
            autoComplete="off"
            invalid={Boolean(errors.name ?? serverError('name'))}
          />
        </FormField>

        <FormField
          label="Environment"
          name="environment"
          error={errors.environment?.message ?? serverError('environment')}
          description="Sandbox has no fiscal device attached, so nothing prints or registers for real."
        >
          <Select {...form.register('environment')}>
            <option value="sandbox">Sandbox - https://sandbox.eparagony.pl</option>
            <option value="production">Production - https://api.eparagony.pl</option>
          </Select>
        </FormField>

        <FormField
          label="Client ID"
          name="clientId"
          error={errors.clientId?.message ?? serverError('clientId')}
          description="Issued by eparagony.pl when your integration was approved."
        >
          <Input
            {...form.register('clientId')}
            autoComplete="off"
            invalid={Boolean(errors.clientId ?? serverError('clientId'))}
          />
        </FormField>

        <FormField
          label="Client secret"
          name="clientSecret"
          error={errors.clientSecret?.message ?? serverError('clientSecret')}
          description="Stored securely on the server and never shown again after saving."
        >
          <Input
            {...form.register('clientSecret')}
            type="password"
            placeholder="••••••••••••••••••••••••"
            autoComplete="off"
            invalid={Boolean(errors.clientSecret ?? serverError('clientSecret'))}
          />
        </FormField>

        <FormField
          label="POS ID"
          name="posId"
          error={errors.posId?.message ?? serverError('posId')}
          description="The register or till identifier eparagony.pl stamps on every document."
        >
          <Input
            {...form.register('posId')}
            autoComplete="off"
            invalid={Boolean(errors.posId ?? serverError('posId'))}
          />
        </FormField>

        <FormField
          label="Integration ID (optional)"
          name="integrationId"
          error={errors.integrationId?.message ?? serverError('integrationId')}
          description="Of the form integration:secret. Leave blank if you were not given one."
        >
          <Input
            {...form.register('integrationId')}
            placeholder="openlinker:abc123"
            autoComplete="off"
            invalid={Boolean(errors.integrationId ?? serverError('integrationId'))}
          />
        </FormField>
      </div>

      {/*
        The checklist describes the fiscal PRINTER, which an invoices-only
        connection never touches - so it belongs to the receipt lane alone.
      */}
      {issuesReceipts ? (
        <div className="setup-lane">
          <h3 className="setup-lane__title">Fiscal e-receipts</h3>
          <Alert tone="info" title="Before you connect your printer">
            <p>
              eparagony.pl registers a sale with your own fiscal printer. Three things need to be set
              up first, usually by your printer servicer:
            </p>
            <ul className="check-list">
              <li>
                <span>
                  <strong>An online fiscal printer</strong> - Posnet, Novitus or Elzab - connected to
                  the internet.
                </span>
                <StatusBadge tone="neutral" compact>
                  Your equipment
                </StatusBadge>
              </li>
              <li>
                <span>
                  <strong>eparagony.pl&apos;s printer-control software</strong> running on the
                  machine next to the printer.
                </span>
                <StatusBadge tone="neutral" compact>
                  Your equipment
                </StatusBadge>
              </li>
              <li>
                <span>
                  <strong>The device set up for e-receipts</strong> by your printer servicer.
                </span>
                <StatusBadge tone="neutral" compact>
                  Ask your servicer
                </StatusBadge>
              </li>
            </ul>
          </Alert>
        </div>
      ) : null}

      {issuesInvoices ? (
        <div className="setup-lane" data-testid="eparagony-setup-seller">
          <h3 className="setup-lane__title">Seller on invoices</h3>
          <p className="setup-lane__help">
            eparagony.pl prints these on every invoice this connection issues, as the seller.
          </p>

          <FormField
            label="Tax number (NIP)"
            name="merchantTIN"
            error={errors.merchantTIN?.message ?? serverError('merchantTIN')}
            description="Must be the same NIP as on your eparagony.pl account. eparagony.pl refuses every invoice under a different number."
          >
            <Input
              {...form.register('merchantTIN')}
              inputMode="numeric"
              placeholder="1234567890"
              autoComplete="off"
              invalid={Boolean(errors.merchantTIN ?? serverError('merchantTIN'))}
            />
          </FormField>

          <FormField
            label="Seller name (optional)"
            name="merchantName"
            error={errors.merchantName?.message ?? serverError('merchantName')}
            description="The name as registered. Invoices work without it; a correction needs it."
          >
            <Input
              {...form.register('merchantName')}
              autoComplete="organization"
              invalid={Boolean(errors.merchantName ?? serverError('merchantName'))}
            />
          </FormField>

          <fieldset
            className="eparagony-seller__address"
            aria-labelledby="eparagony-setup-address-legend"
          >
            <legend className="form-field__label" id="eparagony-setup-address-legend">
              Seller address (optional)
            </legend>
            <div className="eparagony-seller__address-row eparagony-seller__address-row--street">
              <FormField label="Street" name="merchantStreet" error={errors.merchantStreet?.message}>
                <Input
                  {...form.register('merchantStreet')}
                  placeholder="Prosta"
                  autoComplete="off"
                  invalid={Boolean(errors.merchantStreet)}
                />
              </FormField>
              <FormField label="Building" name="merchantNumber" error={errors.merchantNumber?.message}>
                <Input
                  {...form.register('merchantNumber')}
                  placeholder="51"
                  autoComplete="off"
                  invalid={Boolean(errors.merchantNumber)}
                />
              </FormField>
              <FormField
                label="Apartment"
                name="merchantApartment"
                error={errors.merchantApartment?.message}
              >
                <Input
                  {...form.register('merchantApartment')}
                  autoComplete="off"
                  invalid={Boolean(errors.merchantApartment)}
                />
              </FormField>
            </div>
            <div className="eparagony-seller__address-row eparagony-seller__address-row--city">
              <FormField
                label="Postal code"
                name="merchantPostalCode"
                error={errors.merchantPostalCode?.message}
              >
                <Input
                  {...form.register('merchantPostalCode')}
                  placeholder="00-838"
                  autoComplete="off"
                  invalid={Boolean(errors.merchantPostalCode)}
                />
              </FormField>
              <FormField label="City" name="merchantCity" error={errors.merchantCity?.message}>
                <Input
                  {...form.register('merchantCity')}
                  placeholder="Warszawa"
                  autoComplete="off"
                  invalid={Boolean(errors.merchantCity)}
                />
              </FormField>
              <FormField label="Country" name="merchantCountry" error={errors.merchantCountry?.message}>
                <Input
                  {...form.register('merchantCountry')}
                  placeholder="PL"
                  autoComplete="off"
                  invalid={Boolean(errors.merchantCountry)}
                />
              </FormField>
            </div>
            <p className="form-field__description">
              Invoices work without it; a correction needs it. Leave it empty, or fill in every part
              except the apartment.
            </p>
          </fieldset>

          <div className="setup-lane__toggle">
            <label className="setup-lane__toggle-label" htmlFor="eparagony-einvoicing-hub">
              <input
                id="eparagony-einvoicing-hub"
                type="checkbox"
                aria-describedby="eparagony-einvoicing-hub-description"
                {...form.register('eInvoicingHubEnabled')}
              />
              <span>Send invoices on to KSeF</span>
            </label>
            <p className="form-field__description" id="eparagony-einvoicing-hub-description">
              {form.watch('eInvoicingHubEnabled')
                ? 'Before the first invoice: give eparagony.pl permission to issue invoices in the KSeF taxpayer app, and switch KSeF on in panel.eparagony.pl. Without both, eparagony.pl refuses the invoice.'
                : 'Off: invoices are issued outside KSeF, which is a complete result. Turn it on once eparagony.pl may send to KSeF for you.'}
            </p>
          </div>
        </div>
      ) : null}

      <div className="form-actions">
        <Button type="submit" disabled={createConnection.isPending}>
          {createConnection.isPending ? 'Connecting…' : 'Connect eparagony.pl'}
        </Button>
      </div>
    </form>
  );
}

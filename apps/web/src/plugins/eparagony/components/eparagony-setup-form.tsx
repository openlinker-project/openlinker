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
  describeConnectionTestFailure,
} from '../../../features/connections';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../../shared/api/api-error';
import {
  EPARAGONY_SELLER_ADDRESS_REQUIRED_FIELDS,
  EPARAGONY_SETUP_DEFAULT_VALUES,
  EparagonyDocumentCapabilityValues,
  eparagonySetupMessage,
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
import { interpolate, renderRich } from '../../../shared/i18n';
import { useEparagonyMessages } from '../messages';
import { describeApiError } from '../../../shared/api/describe-api-error';

/** Copy sub-key for each document lane's checkbox, in product order. */
const DOCUMENT_CHOICE_KEYS = {
  Fiscalization: 'fiscalization',
  Invoicing: 'invoicing',
} as const satisfies Record<EparagonyDocumentCapability, string>;

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
  const copy = useEparagonyMessages().eparagonySetupForm;
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
  const addressPartRequired = eparagonySetupMessage('addressPartRequired');
  const validationMessages = [
    ...Object.values(errors).flatMap((fieldError) =>
      fieldError?.message && fieldError.message !== addressPartRequired ? [String(fieldError.message)] : [],
    ),
    // One summary line for the whole address, rather than one "Required." per empty part.
    ...(hasAddressError ? [copy.addressSummary] : []),
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
      .map(([path, message]) => interpolate(copy.serverFieldError, { path, message }));
  }, [createConnection.error, fieldErrors, copy.serverFieldError]);

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
        <Alert tone="success" title={copy.created.title}>
          {interpolate(createdInvoices ? copy.created.bodyWithSeller : copy.created.body, {
            name: form.getValues('name').trim(),
          })}
        </Alert>

        {/*
          Both are requirements the connection itself cannot carry, and each
          fails later as a refused or held document rather than as anything on
          this page - so they are named here, while the operator is still in
          the setup flow (#3769).
        */}
        {createdInvoices ? (
          <Alert tone="warning" title={copy.nextSteps.title}>
            <ul className="next-steps">
              <li>
                <span>{copy.nextSteps.numbering}</span>
                <Link to={`/connections/${createdConnectionId}/numbering`}>
                  {copy.nextSteps.numberingLink}
                </Link>
              </li>
              {createdBoth ? (
                <li>
                  <span>{copy.nextSteps.rule}</span>
                  <Link to="/settings/sales-documents">{copy.nextSteps.ruleLink}</Link>
                </li>
              ) : null}
            </ul>
          </Alert>
        ) : null}

        {testResult ? (
          <Alert
            tone={testResult.success ? 'success' : 'error'}
            title={testResult.success ? copy.test.passed : copy.test.failed}
          >
            {testResult.success ? null : describeConnectionTestFailure(testResult)}
            {typeof testResult.latencyMs === 'number'
              ? interpolate(copy.test.latency, { ms: testResult.latencyMs })
              : null}
          </Alert>
        ) : null}
        {testConnection.error ? (
          <Alert tone="error" title={copy.test.unableToTest}>
            {describeApiError(testConnection.error, 'eparagony')}
          </Alert>
        ) : null}
        <div className="form-actions">
          <Button type="button" onClick={() => void onTest()} disabled={testConnection.isPending}>
            {testConnection.isPending ? copy.test.testing : copy.test.test}
          </Button>
          <Button tone="secondary" type="button" onClick={() => void navigate('/connections')}>
            {copy.done}
          </Button>
        </div>
      </div>
    );
  }

  const choiceError = errors.enabledCapabilities?.message;
  const strong = { strong: (text: string) => <strong>{text}</strong> };

  return (
    <form className="wizard-card" onSubmit={(event) => void onSubmit(event)} noValidate>
      <BackLink to="/connections/new" label={copy.backLink} className="wizard-card__back" />

      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}
      {createConnection.error ? (
        <Alert tone="error" title={copy.unableToCreate}>
          {describeApiError(createConnection.error, 'eparagony')}
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
        <legend className="capability-fieldset__legend">{copy.documentChoice.legend}</legend>
        <p className="muted-text capability-fieldset__help" id="eparagony-document-choice-help">
          {copy.documentChoice.help}
        </p>
        <ul className="capability-list">
          {EparagonyDocumentCapabilityValues.map((capability) => {
            const id = `new-cap-${capability}`;
            const choice = copy.documentChoice[DOCUMENT_CHOICE_KEYS[capability]];
            return (
              <li key={capability} className="capability-list__item">
                <label htmlFor={id} className="capability-list__label">
                  <input
                    id={id}
                    type="checkbox"
                    value={capability}
                    {...form.register('enabledCapabilities')}
                  />
                  <span className="capability-list__name">{choice.label}</span>
                  <span className="capability-list__code">{capability}</span>
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
          {copy.bothDocumentsNote}
        </Alert>
      ) : null}

      <div className="setup-lane">
        <h3 className="setup-lane__title">{copy.account.title}</h3>
        <FormField
          label={copy.account.name.label}
          name="name"
          error={errors.name?.message ?? serverError('name')}
          description={copy.account.name.description}
        >
          <Input
            {...form.register('name')}
            placeholder={copy.account.name.placeholder}
            autoComplete="off"
            invalid={Boolean(errors.name ?? serverError('name'))}
          />
        </FormField>

        <FormField
          label={copy.account.environment.label}
          name="environment"
          error={errors.environment?.message ?? serverError('environment')}
          description={copy.account.environment.description}
        >
          <Select {...form.register('environment')}>
            <option value="sandbox">{copy.account.environment.sandbox}</option>
            <option value="production">{copy.account.environment.production}</option>
          </Select>
        </FormField>

        <FormField
          label={copy.account.clientId.label}
          name="clientId"
          error={errors.clientId?.message ?? serverError('clientId')}
          description={copy.account.clientId.description}
        >
          <Input
            {...form.register('clientId')}
            autoComplete="off"
            invalid={Boolean(errors.clientId ?? serverError('clientId'))}
          />
        </FormField>

        <FormField
          label={copy.account.clientSecret.label}
          name="clientSecret"
          error={errors.clientSecret?.message ?? serverError('clientSecret')}
          description={copy.account.clientSecret.description}
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
          label={copy.account.posId.label}
          name="posId"
          error={errors.posId?.message ?? serverError('posId')}
          description={copy.account.posId.description}
        >
          <Input
            {...form.register('posId')}
            autoComplete="off"
            invalid={Boolean(errors.posId ?? serverError('posId'))}
          />
        </FormField>

        <FormField
          label={copy.account.integrationId.label}
          name="integrationId"
          error={errors.integrationId?.message ?? serverError('integrationId')}
          description={copy.account.integrationId.description}
        >
          <Input
            {...form.register('integrationId')}
            placeholder={copy.account.integrationId.placeholder}
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
          <h3 className="setup-lane__title">{copy.receipts.title}</h3>
          <Alert tone="info" title={copy.receipts.checklist.title}>
            <p>{copy.receipts.checklist.intro}</p>
            <ul className="check-list">
              <li>
                <span>{renderRich(copy.receipts.checklist.printer, strong)}</span>
                <StatusBadge tone="neutral" compact>
                  {copy.receipts.checklist.yourEquipment}
                </StatusBadge>
              </li>
              <li>
                <span>{renderRich(copy.receipts.checklist.software, strong)}</span>
                <StatusBadge tone="neutral" compact>
                  {copy.receipts.checklist.yourEquipment}
                </StatusBadge>
              </li>
              <li>
                <span>{renderRich(copy.receipts.checklist.device, strong)}</span>
                <StatusBadge tone="neutral" compact>
                  {copy.receipts.checklist.askServicer}
                </StatusBadge>
              </li>
            </ul>
          </Alert>
        </div>
      ) : null}

      {issuesInvoices ? (
        <div className="setup-lane" data-testid="eparagony-setup-seller">
          <h3 className="setup-lane__title">{copy.seller.title}</h3>
          <p className="setup-lane__help">{copy.seller.help}</p>

          <FormField
            label={copy.seller.tin.label}
            name="merchantTIN"
            error={errors.merchantTIN?.message ?? serverError('merchantTIN')}
            description={copy.seller.tin.description}
          >
            <Input
              {...form.register('merchantTIN')}
              inputMode="numeric"
              placeholder={copy.seller.tin.placeholder}
              autoComplete="off"
              invalid={Boolean(errors.merchantTIN ?? serverError('merchantTIN'))}
            />
          </FormField>

          <FormField
            label={copy.seller.name.label}
            name="merchantName"
            error={errors.merchantName?.message ?? serverError('merchantName')}
            description={copy.seller.name.description}
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
              {copy.seller.address.legend}
            </legend>
            <div className="eparagony-seller__address-row eparagony-seller__address-row--street">
              <FormField
                label={copy.seller.address.street.label}
                name="merchantStreet"
                error={errors.merchantStreet?.message}
              >
                <Input
                  {...form.register('merchantStreet')}
                  placeholder={copy.seller.address.street.placeholder}
                  autoComplete="off"
                  invalid={Boolean(errors.merchantStreet)}
                />
              </FormField>
              <FormField
                label={copy.seller.address.number.label}
                name="merchantNumber"
                error={errors.merchantNumber?.message}
              >
                <Input
                  {...form.register('merchantNumber')}
                  placeholder={copy.seller.address.number.placeholder}
                  autoComplete="off"
                  invalid={Boolean(errors.merchantNumber)}
                />
              </FormField>
              <FormField
                label={copy.seller.address.apartment.label}
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
                label={copy.seller.address.postalCode.label}
                name="merchantPostalCode"
                error={errors.merchantPostalCode?.message}
              >
                <Input
                  {...form.register('merchantPostalCode')}
                  placeholder={copy.seller.address.postalCode.placeholder}
                  autoComplete="off"
                  invalid={Boolean(errors.merchantPostalCode)}
                />
              </FormField>
              <FormField
                label={copy.seller.address.city.label}
                name="merchantCity"
                error={errors.merchantCity?.message}
              >
                <Input
                  {...form.register('merchantCity')}
                  placeholder={copy.seller.address.city.placeholder}
                  autoComplete="off"
                  invalid={Boolean(errors.merchantCity)}
                />
              </FormField>
              <FormField
                label={copy.seller.address.country.label}
                name="merchantCountry"
                error={errors.merchantCountry?.message}
              >
                <Input
                  {...form.register('merchantCountry')}
                  placeholder={copy.seller.address.country.placeholder}
                  autoComplete="off"
                  invalid={Boolean(errors.merchantCountry)}
                />
              </FormField>
            </div>
            <p className="form-field__description">{copy.seller.address.description}</p>
          </fieldset>

          <div className="setup-lane__toggle">
            <label className="setup-lane__toggle-label" htmlFor="eparagony-einvoicing-hub">
              <input
                id="eparagony-einvoicing-hub"
                type="checkbox"
                aria-describedby="eparagony-einvoicing-hub-description"
                {...form.register('eInvoicingHubEnabled')}
              />
              <span>{copy.seller.hub.label}</span>
            </label>
            <p className="form-field__description" id="eparagony-einvoicing-hub-description">
              {form.watch('eInvoicingHubEnabled') ? copy.seller.hub.on : copy.seller.hub.off}
            </p>
          </div>
        </div>
      ) : null}

      <div className="form-actions">
        <Button type="submit" disabled={createConnection.isPending}>
          {createConnection.isPending ? copy.connecting : copy.connect}
        </Button>
      </div>
    </form>
  );
}

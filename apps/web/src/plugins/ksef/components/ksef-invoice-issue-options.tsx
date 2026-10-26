/**
 * KsefInvoiceIssueOptions (DEF-20)
 *
 * The KSeF `invoiceIssueOptions` slot: what the operator states about ONE sale
 * when issuing by hand, mapped server-side onto FA(3) - split payment (P_18A)
 * and triangulation (P_23) in Adnotacje, an extra party in Podmiot3 (a public
 * sector unit, role 8, or a VAT group member, role 10), and GTU / Procedura
 * markers per line.
 *
 * Nothing here is ever ticked for the operator. Whether a sale needs split
 * payment or a GTU marker is a reading of the law, and OpenLinker may read it
 * wrongly, so the form only offers the choice and explains it. Closed by
 * default behind a disclosure: most invoices need none of it.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { Button } from '../../../shared/ui/button';
import type { InvoiceIssueOptionsProps } from '../../../shared/plugins/plugin.types';
import type {
  IssueInvoiceAdditionalPartyInput,
  IssueInvoiceLineClassificationInput,
  IssueInvoiceOptions,
} from '../../../features/invoicing';

/** FA(3) TGTU: GTU_01 .. GTU_13. */
export const KSEF_GTU_CODES = Array.from(
  { length: 13 },
  (_, i) => `GTU_${String(i + 1).padStart(2, '0')}`
);

/** FA(3) Procedura values an operator plausibly marks on a webshop sale. */
export const KSEF_PROCEDURE_CODES = [
  'WSTO_EE',
  'IED',
  'TT_D',
  'MR_T',
  'MR_UZ',
  'I_42',
  'I_63',
  'B_SPV',
  'B_SPV_DOSTAWA',
  'B_MPV_PROWIZJA',
] as const;

/** TRolaPodmiotu3 values the slot offers: the two the buyer flags depend on. */
const PARTY_ROLES = [
  { value: '8', labelKey: 'ksef.issueOptions.roleJst', label: 'Public sector unit (JST, role 8)' },
  { value: '10', labelKey: 'ksef.issueOptions.roleGv', label: 'VAT group member (role 10)' },
] as const;

/** A copy of `value` without `key` - so an emptied option leaves no `{}` on the wire. */
function omitKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function withAnnotation(
  value: IssueInvoiceOptions,
  key: 'splitPayment' | 'triangulation',
  checked: boolean
): IssueInvoiceOptions {
  const annotations = { ...value.annotations };
  if (checked) {
    annotations[key] = true;
  } else {
    delete annotations[key];
  }
  const rest = omitKey(value, 'annotations');
  return Object.keys(annotations).length > 0 ? { ...rest, annotations } : rest;
}

function withLineMarker(
  value: IssueInvoiceOptions,
  orderLineId: string,
  field: 'gtuCode' | 'procedureCode',
  code: string
): IssueInvoiceOptions {
  const others = (value.lineClassifications ?? []).filter((c) => c.orderLineId !== orderLineId);
  const current: IssueInvoiceLineClassificationInput = {
    ...(value.lineClassifications ?? []).find((c) => c.orderLineId === orderLineId),
    orderLineId,
  };
  if (code === '') {
    delete current[field];
  } else {
    current[field] = code;
  }
  const keep = current.gtuCode !== undefined || current.procedureCode !== undefined;
  const lineClassifications = keep ? [...others, current] : others;
  const rest = omitKey(value, 'lineClassifications');
  return lineClassifications.length > 0 ? { ...rest, lineClassifications } : rest;
}

function withParty(
  value: IssueInvoiceOptions,
  party: IssueInvoiceAdditionalPartyInput | null
): IssueInvoiceOptions {
  const rest = omitKey(value, 'additionalParties');
  return party ? { ...rest, additionalParties: [party] } : rest;
}

export function KsefInvoiceIssueOptions({
  lines,
  value,
  onChange,
  disabled = false,
}: InvoiceIssueOptionsProps): ReactElement {
  const { t } = useTranslation();
  const annotations = value.annotations ?? {};
  const party = value.additionalParties?.[0] ?? null;
  const markerOf = (lineId: string): IssueInvoiceLineClassificationInput | undefined =>
    value.lineClassifications?.find((c) => c.orderLineId === lineId);

  return (
    <details className="ksef-issue-options" data-testid="ksef-issue-options">
      <summary>{t('ksef.issueOptions.summary', 'KSeF details for this invoice')}</summary>
      <p className="text-muted ksef-issue-options__lead">
        {t(
          'ksef.issueOptions.lead',
          'Nothing here is set for you. Tick only what applies to this sale; your accountant knows best.'
        )}
      </p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={annotations.splitPayment === true}
          onChange={(e) => onChange(withAnnotation(value, 'splitPayment', e.target.checked))}
          disabled={disabled}
        />
        <span>
          {t('ksef.issueOptions.splitPayment', 'Split payment (MPP)')}
          <small className="text-muted ksef-issue-options__hint">
            {t(
              'ksef.issueOptions.splitPaymentHint',
              'Usually needed for goods listed in annex 15 when the invoice is over 15 000 PLN gross.'
            )}
          </small>
        </span>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={annotations.triangulation === true}
          onChange={(e) => onChange(withAnnotation(value, 'triangulation', e.target.checked))}
          disabled={disabled}
        />
        <span>
          {t('ksef.issueOptions.triangulation', 'Triangular transaction (WDT, second taxpayer)')}
        </span>
      </label>

      <fieldset className="ksef-issue-options__party">
        <legend>
          {t('ksef.issueOptions.partyLegend', 'Another party on the invoice (Podmiot3)')}
        </legend>
        {party ? (
          <>
            <FormField label={t('ksef.issueOptions.partyRole', 'Role')} name="ksef-party-role">
              <Select
                value={party.role}
                onChange={(e) => onChange(withParty(value, { ...party, role: e.target.value }))}
                disabled={disabled}
              >
                {PARTY_ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {t(role.labelKey, role.label)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('ksef.issueOptions.partyName', 'Name')} name="ksef-party-name">
              <Input
                value={party.name}
                onChange={(e) => onChange(withParty(value, { ...party, name: e.target.value }))}
                disabled={disabled}
                maxLength={512}
              />
            </FormField>
            <FormField label={t('ksef.issueOptions.partyNip', 'NIP')} name="ksef-party-nip">
              <Input
                value={party.taxId?.value ?? ''}
                inputMode="numeric"
                onChange={(e) => {
                  const nip = e.target.value;
                  const noTaxId = omitKey(party, 'taxId');
                  onChange(
                    withParty(
                      value,
                      nip.trim() === ''
                        ? noTaxId
                        : { ...party, taxId: { scheme: 'pl-nip', value: nip } }
                    )
                  );
                }}
                disabled={disabled}
              />
            </FormField>
            <Button
              tone="ghost"
              onClick={() => onChange(withParty(value, null))}
              disabled={disabled}
            >
              {t('ksef.issueOptions.removeParty', 'Remove this party')}
            </Button>
          </>
        ) : (
          <Button
            tone="ghost"
            onClick={() => onChange(withParty(value, { role: '8', name: '' }))}
            disabled={disabled}
          >
            {t('ksef.issueOptions.addParty', 'Add a party')}
          </Button>
        )}
      </fieldset>

      {lines.length > 0 ? (
        <div className="ksef-issue-options__lines-scroll">
          <table className="ksef-issue-options__lines">
            <caption>{t('ksef.issueOptions.linesCaption', 'Markers per line')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('ksef.issueOptions.line', 'Line')}</th>
                <th scope="col">{t('ksef.issueOptions.gtu', 'GTU')}</th>
                <th scope="col">{t('ksef.issueOptions.procedure', 'Procedure')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const marker = markerOf(line.id);
                const lineLabel = line.name ?? t('ksef.issueOptions.lineN', `Line ${index + 1}`);
                return (
                  <tr key={line.id}>
                    <td>{lineLabel}</td>
                    <td>
                      <Select
                        aria-label={t('ksef.issueOptions.gtuFor', `GTU for ${lineLabel}`)}
                        value={marker?.gtuCode ?? ''}
                        onChange={(e) =>
                          onChange(withLineMarker(value, line.id, 'gtuCode', e.target.value))
                        }
                        disabled={disabled}
                      >
                        <option value="">{t('ksef.issueOptions.none', 'None')}</option>
                        {KSEF_GTU_CODES.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <Select
                        aria-label={t(
                          'ksef.issueOptions.procedureFor',
                          `Procedure for ${lineLabel}`
                        )}
                        value={marker?.procedureCode ?? ''}
                        onChange={(e) =>
                          onChange(withLineMarker(value, line.id, 'procedureCode', e.target.value))
                        }
                        disabled={disabled}
                      >
                        <option value="">{t('ksef.issueOptions.none', 'None')}</option>
                        {KSEF_PROCEDURE_CODES.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  );
}

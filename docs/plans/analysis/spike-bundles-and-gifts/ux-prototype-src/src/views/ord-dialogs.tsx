/**
 * Order detail dialogs: add a gift by hand, and edit lines (refused on a bundle line).
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@web/shared/ui/dialog';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { Combobox, type ComboboxOption, type ComboboxValue } from '@web/shared/ui/combobox';
import { FormField } from '@web/shared/ui/form-field';
import { Input } from '@web/shared/ui/input';
import { Select } from '@web/shared/ui/select';
import { useToast } from '@web/shared/ui/toast-provider';
import { VARIANTS } from '../model/catalog';
import { useMoney, useProto, useWriteGuard } from '../proto';
import { StockPathTrail, WhoPaysStrip } from '../ui/marks';
import { gift, lineName, v, type OrdLine, type OrdScenario } from './ord-data';
import { masterShort } from './ord-ui';

export type AddGiftMode = 'before-routing' | 'after-routing' | 'after-packing' | 'after-invoice';

const REASONS = ['Przeprosiny za problem z zamówieniem', 'Obietnica z opisu oferty', 'Prezent dla stałego klienta', 'Inny powód'];

export function AddGiftDialog({
  open,
  onOpenChange,
  mode,
  s,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: AddGiftMode;
  s: OrdScenario;
  onAdded: (line: OrdLine) => void;
}): ReactElement {
  const money = useMoney();
  const { oms } = useProto();
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const [value, setValue] = useState<ComboboxValue | null>({ kind: 'dictionary', ids: ['spoon'] });
  const [qty, setQty] = useState('1');
  const [why, setWhy] = useState(REASONS[0]);
  const options: ComboboxOption[] = useMemo(
    () =>
      Object.entries(VARIANTS).map(([key, x]) => {
        const free = Math.max(0, x.stock - x.held);
        return {
          id: key,
          label: x.name,
          hint: `wolne ${String(free)} szt. · koszt ${x.cost === null ? 'nieznany' : money(x.cost, 'PLN')}`,
          disabled: free === 0,
          disabledReason: free === 0 ? 'Brak na stanie' : undefined,
        };
      }),
    [money],
  );
  const picked = value?.kind === 'dictionary' ? value.ids[0] : undefined;
  const n = Math.max(1, Number.parseInt(qty, 10) || 1);
  const refused = mode === 'after-packing';
  const master = masterShort(picked);
  const blocked = !canWrite || refused || !picked;
  const title = !canWrite ? reason : refused ? 'Paczka jest już spakowana. Gratis nie trafi do tej paczki.' : !picked ? 'Wybierz produkt' : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ord-dialog" aria-describedby="ord-add-gift-desc">
        <DialogTitle>Dodaj gratis</DialogTitle>
        <DialogDescription id="ord-add-gift-desc">
          Zamówienie {s.number}. Gratis trafi do zamówienia w OpenLinkerze. Kupujący nic za niego nie płaci.
        </DialogDescription>

        {mode === 'after-routing' ? (
          <Alert tone="warning" density="compact" title="Zamówienie jest już przydzielone do pakowania">
            Dodanie gratisu utworzy nowe zadanie pakowania dla tej paczki. Pakowacz zobaczy gratis jako osobną pozycję do zeskanowania.
          </Alert>
        ) : null}
        {mode === 'after-packing' ? (
          <Alert tone="error" density="compact" title="Za późno na gratis w tej paczce">
            Paczkę spakowano 4 listopada o 10:12. Gratis nie trafi już do środka. Wyślij go osobną paczką albo dopisz do następnego zamówienia klienta.
          </Alert>
        ) : null}
        {mode === 'after-invoice' ? (
          <Alert tone="warning" density="compact" title="Dokument sprzedaży jest już wystawiony">
            Paragon PAR/2026/11/0412 wystawiono przed dodaniem gratisu, więc go nie ma. OpenLinker nie zmienia wystawionego dokumentu. Kwota się nie zmienia, ale sprawdź formę gratisu w ustawieniach dokumentów.
          </Alert>
        ) : null}

        <div className="ord-form">
          <FormField label="Produkt" name="gift-product" description="Widzisz wolny stan i koszt zakupu netto.">
            <Combobox options={options} value={value} onChange={setValue} placeholder="Wybierz produkt" disabled={refused} />
          </FormField>
          <div className="ord-form__row">
            <FormField label="Ilość" name="gift-qty">
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} disabled={refused} />
            </FormField>
            <FormField label="Powód" name="gift-reason">
              <Select value={why} onChange={(e) => setWhy(e.target.value)} disabled={refused}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </div>

        {picked ? (
          <div className="ord-preview">
            <p className="ord-preview__label">Podgląd</p>
            <WhoPaysStrip qty={n} unitCost={v(picked).cost} />
            <StockPathTrail
              label="Ścieżka stanu gratisu"
              steps={
                refused
                  ? [
                      { label: 'Zarezerwowano', state: 'skipped' },
                      { label: 'Spakowano', state: 'blocked', detail: 'paczka zamknięta' },
                    ]
                  : oms
                    ? [
                        { label: 'Zarezerwowano', state: 'todo' },
                        { label: 'Spakowano', state: 'todo', detail: mode === 'after-routing' ? 'nowe zadanie pakowania' : undefined },
                        { label: `Zdjęto ze stanu w ${master}`, state: 'todo', detail: 'powód: gratis' },
                      ]
                    : [
                        { label: `Wysłano do ${master} jako pozycja 0,00 zł`, state: 'todo' },
                        { label: 'Sklep zdjął stan', state: 'todo' },
                      ]
              }
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button tone="ghost" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button
            tone="primary"
            disabled={blocked}
            title={title}
            onClick={() => {
              if (!picked) return;
              onAdded(gift(`ol-gift:operator:${String(Date.now()).slice(-4)}`, picked, n, 'operator', { olOnly: s.channel === 'allegro' || s.channel === 'erli', status: { label: 'Zarezerwowano', tone: 'success' }, note: `Dodany ręcznie: ${why}` }));
              showToast({ tone: 'success', title: 'Dodano gratis', description: `${v(picked).name} x${String(n)}. Zarezerwowano w ${master}.` });
              onOpenChange(false);
            }}
          >
            Dodaj gratis
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditLinesDialog({ open, onOpenChange, s }: { open: boolean; onOpenChange: (v: boolean) => void; s: OrdScenario }): ReactElement {
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const editable = s.lines.filter((l) => l.kind === 'goods' || l.kind === 'bundle');
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(editable.map((l) => [l.id, String(l.qty)])));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ord-dialog" aria-describedby="ord-edit-desc">
        <DialogTitle>Edytuj pozycje</DialogTitle>
        <DialogDescription id="ord-edit-desc">Możesz zmniejszyć ilość. Kanał zachowa swoją wersję zamówienia.</DialogDescription>
        <ul className="ord-edit">
          {editable.map((l) => (
            <li key={l.id} className="ord-edit__row">
              <span className="ord-edit__name">
                {lineName(l)} <span className="ord-line-id">{l.id}</span>
              </span>
              <Input
                type="number"
                min={0}
                max={l.qty}
                className="ord-edit__qty"
                aria-label={`Ilość: ${lineName(l)}`}
                value={qty[l.id] ?? ''}
                disabled={l.kind === 'bundle'}
                onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
              />
              {l.kind === 'bundle' ? (
                <Alert tone="info" density="compact" className="ord-edit__refusal" title="Tej pozycji nie można zmienić: to zestaw">
                  Edycja ilości nie rozkłada jeszcze zmiany na składniki: rezerwacje, zadanie pakowania i zdjęcie stanu są zapisane na każdym składniku osobno. Zmiana tylko na zestawie zostawiłaby je bez zmian. Anuluj całe zamówienie albo poproś klienta o zmianę w kanale sprzedaży.{' '}
                  <code className="ord-code">LINE_IS_BUNDLE</code>
                </Alert>
              ) : null}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button tone="ghost" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button
            tone="primary"
            disabled={!canWrite}
            title={reason}
            onClick={() => {
              showToast({ tone: 'success', title: 'Zapisano zmiany', description: 'Ilości pozycji poza zestawem zaktualizowane.' });
              onOpenChange(false);
            }}
          >
            Zapisz zmiany
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

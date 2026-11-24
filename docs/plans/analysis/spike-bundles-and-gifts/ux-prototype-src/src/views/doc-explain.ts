/**
 * "Dlaczego tak": 2-4 plain Polish bullets per configuration. What the rule does,
 * the risk, and what the operator can change. Research, not legal advice.
 */
import { BUNDLES, VARIANTS } from '../model/catalog';
import { latest, type DocResult } from '../model/calc';
import { SCENARIOS, type LabConfig } from './doc-data';

export type Risk = 'niskie' | 'średnie' | 'wysokie' | 'brak';

const zl = (g: number): string => `${(g / 100).toFixed(2).replace('.', ',')} zł`;

export function explain(cfg: LabConfig, doc: DocResult): { risk: Risk; bullets: string[] } {
  const sc = SCENARIOS[cfg.scenario];
  const bullets: string[] = [];
  let risk: Risk = 'niskie';

  if (sc.gift) {
    const g = VARIANTS[sc.gift.variant];
    const paidRates = [...new Set(sc.paidLines.map((p) => p.vat))].join('%, ');
    switch (cfg.treatment) {
      case 'omit':
        if (doc.status === 'ready') {
          bullets.push(`Gratis nie trafia na dokument. Cała zapłata zostaje w stawce ${g.vat}%, tej samej co stawka gratisu, więc podatek się nie przesuwa.`);
          bullets.push('Kasa i KSeF przyjmują taki dokument bez zmian.');
        } else {
          risk = 'brak';
          bullets.push(`Pominięcie przesunęłoby wartość między stawkami: gratis ma ${g.vat}%, a płatna pozycja ${paidRates}%.`);
          bullets.push('OpenLinker nie wybiera za Ciebie i wstrzymuje dokument z nazwanym powodem. Nic nie poszło do kasy ani do KSeF.');
          bullets.push('Wybierz inną formę gratisu: 0,01 zł, udział w cenie albo ewidencję wewnętrzną.');
        }
        break;
      case 'hold':
        risk = 'brak';
        bullets.push('Forma gratisu na dokumencie nie jest ustawiona, więc dokument czeka. Nic nie poszło do kasy ani do KSeF.');
        bullets.push('Ustaw formę raz w ustawieniach połączenia. Wstrzymane dokumenty wystawią się po zmianie.');
        break;
      case 'grosz':
        bullets.push(`Gratis ma cenę 0,01 zł w swojej stawce ${g.vat}%. Ten grosz jest zdjęty z płatnej pozycji, więc suma dokumentu jest równa temu, co zapłacił klient.`);
        bullets.push('Interpretacje KIS z 2025 i 2026 r. uznały sprzedaż za 1 grosz za sprzedaż odpłatną.');
        bullets.push('Stawka gratisu ma wartość 0,01 zł, więc eparagony jej nie odrzuci.');
        break;
      case 'priced-in':
        bullets.push('Część zapłaty przechodzi na gratis proporcjonalnie do cen osobno, nigdy powyżej jego własnej ceny.');
        bullets.push(`Gratis jest opodatkowany w swojej stawce ${g.vat}%. Gdy ta stawka jest wyższa niż stawka płatnej pozycji, należny VAT rośnie.`);
        bullets.push('Klient widzi niższą cenę płatnej pozycji niż w ofercie.');
        break;
      case 'internal-record': {
        risk = 'średnie';
        const cost = g.cost ?? 0;
        bullets.push(`Gratis nie jest na paragonie ani na fakturze. OpenLinker zapisuje go w ewidencji nieodpłatnych przekazań z ceną nabycia i stawką ${g.vat}%.`);
        bullets.push('To decyzja, że gratis jest nieodpłatny (art. 7 ust. 2). Od ceny nabycia może należeć się VAT.');
        bullets.push(
          cost <= 2000
            ? `Cena nabycia ${zl(cost)} netto jest poniżej 20 zł, więc gratis może być prezentem o małej wartości. Próg liczy się od kosztu, nie od ceny.`
            : `Cena nabycia ${zl(cost)} netto przekracza 20 zł, więc to nie jest prezent o małej wartości bez ewidencji.`,
        );
        break;
      }
      case 'rebate-100':
        risk = 'wysokie';
        bullets.push('Cena katalogowa z rabatem 100% to forma, którą KIS w 2026 r. uznała za nieodpłatną dostawę opodatkowaną od ceny nabycia.');
        bullets.push('OpenLinker jej nie oferuje. Podgląd pokazuje najbliższą bezpieczną formę: 0,01 zł.');
        break;
    }
  }

  if (sc.hasBundle) {
    const key = sc.paidLines[0].bundle;
    const comps = key ? latest(BUNDLES[key]).filter((c) => !c.gift) : [];
    const rates = [...new Set(comps.map((c) => VARIANTS[c.variant].vat))];
    if (cfg.bundleMode === 'one-line') {
      bullets.push(
        rates.length > 1
          ? `Zestaw jest jedną pozycją w stawce wariantu zestawu z mastera (23%), choć składniki mają ${rates.join('% i ')}%. W pilocie dokument zostaje przy jednej linii; przełącz na składniki, żeby każdy miał swoją stawkę.`
          : 'Zestaw jest jedną pozycją w stawce wariantu zestawu z mastera.',
      );
      if (rates.length > 1 && risk === 'niskie') risk = 'średnie';
    } else {
      bullets.push('Cena zestawu jest dzielona proporcjonalnie do cen składników osobno, reszta w groszach trafia na największy udział. Podział jest zamrażany przy sprzedaży i używany przy zwrocie.');
    }
  }

  if (sc.serviceNames) {
    bullets.push('Pakowanie na prezent to płatna usługa: osobna pozycja ze stawką 23% i bez stanu magazynowego.');
    bullets.push('Bez tej pozycji pozycje i dostawa nie dałyby sumy zamówienia i dokument byłby wstrzymany. Pakowacz widzi na stanowisku: zapakuj na prezent.');
  }

  if (!sc.gift && !sc.hasBundle && !sc.serviceNames) bullets.push('Zwykłe pozycje, bez gratisu i zestawu.');

  if (cfg.provider === 'ksef' && bullets.length < 4) bullets.push('KSeF: kolumna P_10 pokazuje opusty, gdy nie są w cenie jednostkowej. Gratis ma własną cenę, więc jego opust wynosi 0,00 zł.');
  if (cfg.provider === 'eparagony' && doc.status === 'refused' && bullets.length < 4) bullets.push('eparagony odrzuca stawkę o wartości 0,00 zł (kod 41), więc OpenLinker sprawdza to przed wysłaniem.');

  return { risk, bullets: bullets.slice(0, 4) };
}

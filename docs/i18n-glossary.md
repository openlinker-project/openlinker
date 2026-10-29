# UI glossary: English and Polish

The terms an operator meets in OpenLinker, with the one Polish form the UI uses for each. Translators and agents use this table so the same thing is never called two names. See [ADR-079](./architecture/adrs/079-frontend-owned-ui-translation.md) and [frontend-architecture.md § Internationalization](./frontend-architecture.md#internationalization-i18n).

Add a row when a new domain term reaches the UI. Change a row only together with every copy file that uses it.

## How Polish copy is written

- **Buttons and menu items** use the imperative, second person singular, no pronoun: "Zapisz zmiany", "Utwórz przesyłkę", "Anuluj".
- **Messages** are neutral and direct. No "Pan/Pani", no exclamation marks, no apologies: "Nie udało się zapisać zmian. Spróbuj ponownie."
- **Sentence case** in both languages; only proper names are capitalised.
- **Plural forms**: every count has `one`, `few`, `many` and `other` forms (1 zamówienie, 2 zamówienia, 5 zamówień; `other` is for fractions, 1,5 zamówienia). The count is written `{n}`; keep the token.
- **Brand and platform names are not translated**: OpenLinker, Allegro, Erli, InPost, Paczkomat, DPD, WooCommerce, PrestaShop, Subiekt, inFakt, KSeF.
- **Legal and tax terms already in Polish stay as they are**: NIP, KSeF, UPO, paragon, faktura.
- A plain hyphen, never an em dash.

## Terms

| English (UI) | Polish (UI) | Notes |
|---|---|---|
| Order | Zamówienie | |
| Order line | Pozycja zamówienia | |
| Listing / offer | Oferta | marketplace listing |
| Product | Produkt | |
| Variant | Wariant | |
| Customer | Klient | |
| Buyer | Kupujący | the person who placed the order |
| Seller | Sprzedawca | |
| Connection | Połączenie | a configured integration instance |
| Integration | Integracja | the product type (Allegro, PrestaShop, ...) |
| Marketplace | Marketplace | kept in English, common in Polish e-commerce |
| Online shop | Sklep internetowy | |
| Sales channel | Kanał sprzedaży | |
| Destination | Kanał docelowy | where a listing or product is published (a connection, not a place) |
| Shipment | Przesyłka | |
| Parcel | Paczka | |
| Shipping label | Etykieta nadawcza | |
| Tracking number | Numer przesyłki | what the buyer is given to follow the parcel; the same identifier as the waybill number, so use "Numer przesyłki" in buyer-facing and status text |
| Carrier | Przewoźnik | |
| Parcel locker | Automat paczkowy | "Paczkomat" only for InPost (brand) |
| Pickup point | Punkt odbioru | |
| Waybill | List przewozowy | the document; say "List przewozowy" only when the document is meant, otherwise "Numer przesyłki" |
| Dispatch | Nadanie | verb: nadaj |
| Fulfilment | Realizacja zamówienia | short form "realizacja" in tight space |
| Fulfilment task | Zadanie realizacji | |
| Pack bench | Stanowisko pakowania | |
| Packer | Pakowacz | |
| Return | Zwrot | goods coming back |
| Refund | Zwrot pieniędzy | money going back; never just "zwrot" |
| Restock | Przyjęcie na stan | |
| Stock | Stan magazynowy | |
| Inventory | Stany magazynowe | the area / module |
| Warehouse | Magazyn | a physical site, as in "Magazyn główny"; never the name of the module |
| Warehouse location | Lokalizacja magazynowa | |
| Reservation | Rezerwacja | |
| Hold | Wstrzymanie | verb: wstrzymaj |
| Sales document | Dokument sprzedaży | invoice or receipt |
| Invoice | Faktura | |
| Correction invoice | Faktura korygująca | short form "korekta" in tight space |
| Receipt | Paragon | |
| Fiscal receipt | Paragon fiskalny | |
| Tax ID | NIP | Polish tax ID; generic "numer podatkowy" for foreign buyers |
| VAT rate | Stawka VAT | |
| Gross / net | Brutto / netto | |
| Price change | Zmiana ceny | |
| Pricing rule | Reguła cenowa | |
| Category | Kategoria | |
| Attribute | Atrybut | |
| Parameter | Parametr | marketplace category parameter |
| Mapping | Mapowanie | |
| Sync | Synchronizacja | verb: synchronizuj |
| Job | Zadanie w tle | background job; never shortened to bare "zadanie", which means the fulfilment task |
| Webhook | Webhook | |
| Automation | Automatyzacja | |
| Needs attention | Wymaga uwagi | |
| Draft | Szkic | |
| Publish | Opublikuj | |
| Bulk | Zbiorczo | "Edycja zbiorcza", "Publikacja zbiorcza" |
| Settings | Ustawienia | |
| Sign in / sign out | Zaloguj się / Wyloguj się | |
| Language | Język | |

## Never in copy

Words that describe how OpenLinker is built, not what the operator does. `check-ui-vocabulary` bans the English ones; the Polish counterparts are not machine-checked, so reviewers watch for them.

| English (banned) | Polish counterpart (banned) |
|---|---|
| authority | autorytet |
| phase | faza |
| holder | posiadacz |
| gateway | bramka |
| posture | postawa |

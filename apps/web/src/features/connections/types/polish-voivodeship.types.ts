/**
 * Polish Voivodeship Types
 *
 * Mirror of the BE `PolishVoivodeshipValues` (#430) with operator-facing
 * Polish display labels for the Allegro seller-defaults Select. Kept in
 * sync manually — if the BE ever changes the enum, this file fails the
 * `EditConnectionForm` test that asserts every BE value is rendered.
 *
 * Source of truth: `libs/integrations/allegro/src/domain/types/allegro-location.types.ts`.
 */

export const POLISH_VOIVODESHIP_VALUES = [
  'DOLNOSLASKIE',
  'KUJAWSKO_POMORSKIE',
  'LUBELSKIE',
  'LUBUSKIE',
  'LODZKIE',
  'MALOPOLSKIE',
  'MAZOWIECKIE',
  'OPOLSKIE',
  'PODKARPACKIE',
  'PODLASKIE',
  'POMORSKIE',
  'SLASKIE',
  'SWIETOKRZYSKIE',
  'WARMINSKO_MAZURSKIE',
  'WIELKOPOLSKIE',
  'ZACHODNIOPOMORSKIE',
] as const;

export type PolishVoivodeship = (typeof POLISH_VOIVODESHIP_VALUES)[number];

/**
 * Operator-facing display labels — Polish locale, since this is a
 * PL-marketplace connection setting and operators are typically Polish
 * sellers.
 */
export const POLISH_VOIVODESHIP_LABELS: Record<PolishVoivodeship, string> = {
  DOLNOSLASKIE: 'dolnośląskie',
  KUJAWSKO_POMORSKIE: 'kujawsko-pomorskie',
  LUBELSKIE: 'lubelskie',
  LUBUSKIE: 'lubuskie',
  LODZKIE: 'łódzkie',
  MALOPOLSKIE: 'małopolskie',
  MAZOWIECKIE: 'mazowieckie',
  OPOLSKIE: 'opolskie',
  PODKARPACKIE: 'podkarpackie',
  PODLASKIE: 'podlaskie',
  POMORSKIE: 'pomorskie',
  SLASKIE: 'śląskie',
  SWIETOKRZYSKIE: 'świętokrzyskie',
  WARMINSKO_MAZURSKIE: 'warmińsko-mazurskie',
  WIELKOPOLSKIE: 'wielkopolskie',
  ZACHODNIOPOMORSKIE: 'zachodniopomorskie',
};

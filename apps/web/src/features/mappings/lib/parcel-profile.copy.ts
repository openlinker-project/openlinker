/**
 * Parcel profile operator copy (#3652)
 *
 * @module apps/web/src/features/mappings/lib
 */
export const PARCEL_COPY = {
  columnHeader: 'Default parcel',
  sectionTitle: 'Default parcel for this delivery method',
  sectionHint:
    'Used to pre-fill the label form and bulk dispatch for orders shipped with this method. You can still change every value per order.',
  noneSet: 'Not set',
  setAction: 'Set parcel',
  editAction: 'Edit parcel',
  clearAction: 'Clear parcel',
  applyAction: 'Apply',
  cancelAction: 'Cancel',
  templateLabel: 'Size',
  templateNone: 'No size',
  lengthLabel: 'Length (cm)',
  widthLabel: 'Width (cm)',
  heightLabel: 'Height (cm)',
  weightLabel: 'Weight (kg)',
  boxIncomplete: 'Enter length, width and height together, or leave all three empty.',
  notPositive: 'Values must be greater than zero.',
  sizeSummary: (template: string): string => `Size ${template}`,
  boxSummary: (l: string, w: string, h: string): string => `Box ${l} x ${w} x ${h} cm`,
  weightSummary: (kg: string): string => `${kg} kg`,
} as const;

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
  templateOther: 'Other carrier code',
  customTemplateLabel: 'Carrier size code',
  customTemplateEmpty: 'Enter the carrier size code, or pick a size from the list.',
  templateTooLong: (max: number): string => `The size code must be ${max} characters or fewer.`,
  lengthLabel: 'Length (cm)',
  widthLabel: 'Width (cm)',
  heightLabel: 'Height (cm)',
  weightLabel: 'Weight (kg)',
  boxIncomplete: 'Enter length, width and height together, or leave all three empty.',
  notPositive: 'Values must be greater than zero.',
  tooLarge: (maxCm: number): string => `Length, width and height must each be ${maxCm} cm or less.`,
  weightTooLarge: (maxKg: number): string => `Weight must be ${maxKg} kg or less.`,
  sizeSummary: (template: string): string => `Size ${template}`,
  boxSummary: (l: string, w: string, h: string): string => `Box ${l} x ${w} x ${h} cm`,
  weightSummary: (kg: string): string => `${kg} kg`,
} as const;

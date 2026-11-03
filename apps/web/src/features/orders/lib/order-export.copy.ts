/**
 * Orders export + column panel copy (#3534, #3530, #3507 PR 7/8, mockup M5)
 *
 * One home for the export dialog's, the background toast's and the list's
 * Columns panel's operator-facing strings, so the same act is never phrased
 * two ways and `check-ui-vocabulary` scans them as copy.
 *
 * @module apps/web/src/features/orders/lib
 */

export const ORDER_EXPORT_COPY = {
  title: 'Export orders',
  description:
    'Download orders as a spreadsheet file. Nothing in OpenLinker or on your channels changes.',
  ordersHead: 'Orders',
  ordersGroupLabel: 'Orders to export',
  scopeView: 'Current view',
  scopeViewHintFallback: 'The orders matching your current filters and sort',
  scopeSelected: 'Selected orders',
  scopeSelectedHintNone: 'Tick orders in the table first',
  scopeSelectedHint: (n: string, one: boolean): string =>
    one ? 'The order you ticked in the table' : `The ${n} orders you ticked in the table`,
  scopeRange: 'Date range',
  scopeRangeHint: 'All sources, by placed date',
  placedFrom: 'Placed from',
  placedTo: 'Placed to',
  counting: 'Counting…',
  fileHead: 'File',
  format: 'Format',
  formatGroupLabel: 'File format',
  formatCsv: 'CSV',
  formatXlsx: 'Excel (XLSX)',
  separator: 'Separator',
  separatorValue: 'Semicolon (;), Excel in Polish',
  separatorHint: 'UTF-8, opens directly in Excel.',
  columnsHead: 'Columns',
  columnsCount: (n: number, total: number): string => `${n} of ${total}`,
  preset: 'Preset',
  presetBuiltIn: (label: string): string => `${label} (built-in)`,
  presetEdited: (label: string): string => `${label}, edited`,
  presetCustom: 'Custom',
  presetsLoadError: 'Saved presets could not be loaded.',
  saveAsPreset: 'Save as preset',
  presetName: 'Preset name',
  savePreset: 'Save preset',
  cancel: 'Cancel',
  savePresetError: 'The preset could not be saved. Try again.',
  piiDisabledHint: 'Turn on Include personal data to add these.',
  noColumns: 'Choose at least one column.',
  piiHead: 'Personal data',
  piiToggle: 'Include personal data',
  piiToggleHint: 'Buyer names and email addresses.',
  piiWarningTitle: 'This file will contain personal data',
  piiWarningBody:
    'Store it securely and delete it when you no longer need it. Anyone you send it to gets the same data. Orders received while personal data storage was turned off have empty buyer columns.',
  largeTitle: 'This export runs in the background',
  largeBody: (count: string, limit: string): string =>
    `${count} orders is more than can be prepared here (up to ${limit}). You can keep working. Download the file from Jobs & Logs when it is ready; it stays there for 7 days.`,
  startFailed: 'Could not start the export. Try again.',
  summaryRows: (rows: string): string => `${rows} rows`,
  summaryRowsUnknown: 'All matching orders',
  summaryColumns: (n: number): string => `${n} ${n === 1 ? 'column' : 'columns'}`,
  summaryFormat: (format: 'csv' | 'xlsx'): string => (format === 'xlsx' ? 'Excel' : 'CSV'),
  submitCount: (n: string, one: boolean): string => `Export ${n} ${one ? 'order' : 'orders'}`,
  submitUnknown: 'Export orders',
  submitBackground: 'Start background export',
  submitting: 'Starting…',

  preparingTitle: 'Preparing export',
  preparingProgressLabel: 'Export progress',
  preparingStatus: 'Writing rows',
  preparingRows: (n: string): string => `${n} orders`,
  preparingClose:
    'You can close this window. The export keeps running, and the file appears in Jobs & Logs when it is ready.',
  close: 'Close',

  readyTitle: 'Export ready',
  readyBadge: 'ready',
  readyDescription: (rows: string, one: boolean, scope: 'selected' | 'view' | 'range'): string =>
    `${rows} ${one ? 'order' : 'orders'} from ${
      scope === 'selected' ? 'your selection' : scope === 'range' ? 'the date range' : 'the current view'
    }, one row per order.`,
  kvFile: 'File',
  kvRows: 'Rows',
  kvColumns: 'Columns',
  kvColumnsValue: (n: number, preset: string | null): string =>
    preset ? `${n}, ${preset} preset` : String(n),
  kvPersonalData: 'Personal data',
  piiIncluded: 'Included',
  piiNotIncluded: 'Not included',
  kvAvailableUntil: 'Available until',
  readyAgainPrefix: 'You can download it again from ',
  readyAgainSuffix: ' until then.',
  jobsAndLogs: 'Jobs & Logs',
  download: 'Download file',
  downloading: 'Downloading…',
  downloadFailed: 'The file could not be downloaded. Try again, or download it from Jobs & Logs.',

  errorTitle: 'Export failed',
  errorAlertTitle: 'The export could not be generated',
  errorFallback: 'An unexpected error stopped the export. No file was created.',
  errorJobPrefix: 'The job and its error stay in ',
  errorJobSuffix: '.',
  changeSettings: 'Change settings',
  tryAgain: 'Try again',

  toastReadyTitle: 'Export ready',
  toastReadyBody: (rows: string, fileName: string): string => `${rows} orders in ${fileName}.`,
  toastFailedTitle: 'Export failed',
  toastFailedBody: 'The export stopped before a file was written.',
  toastDownload: 'Download',
  toastViewJob: 'View job',
} as const;

export const ORDER_COLUMNS_PANEL_COPY = {
  trigger: 'Columns',
  panelLabel: 'Table columns',
  preset: 'Preset',
  presetCustom: 'Custom',
  presetsLoadError: 'Saved presets could not be loaded.',
  saveAsPreset: 'Save as preset',
  presetName: 'Preset name',
  save: 'Save',
  cancel: 'Cancel',
  saveError: 'The preset could not be saved. Try again.',
  deletePreset: 'Delete preset',
  deleteTitle: 'Delete this preset?',
  deleteDescription: (name: string): string =>
    `“${name}” is removed for you. The columns showing now stay as they are.`,
  deleteConfirm: 'Delete preset',
  listLabel: 'Columns, in table order',
  moveUp: (label: string): string => `Move ${label} up`,
  moveDown: (label: string): string => `Move ${label} down`,
  footHint: 'Applied as you tick',
  setWorkspaceDefault: 'Set as workspace default',
  workspaceDefaultSaved: 'Saved as the workspace default.',
} as const;

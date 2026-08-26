/**
 * Who-Decides Query Keys
 *
 * @module apps/web/src/features/fulfillment-authority/api
 */
export const whoDecidesQueryKeys = {
  all: ['fulfillment-authority'] as const,
  status: () => [...whoDecidesQueryKeys.all, 'status'] as const,
  /**
   * Rooted under `all` deliberately: the apply mutation invalidates `all`, so a
   * diff can never outlive the change it describes. A key rooted anywhere else
   * would leave the dialog explaining a change that already happened.
   */
  preview: (presetId: string) => [...whoDecidesQueryKeys.all, 'preset-preview', presetId] as const,
};

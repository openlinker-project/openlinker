/**
 * Mirakl Import Tracker Port
 *
 * Reads the outcome of an asynchronous Mirakl import. Adapters that submit
 * imports (offers, stock, prices, products) depend on this interface, so their
 * specs can stub outcomes without HTTP.
 *
 * @module libs/integrations/mirakl/src/infrastructure/imports
 */
import type {
  MiraklImportKind,
  MiraklImportLineError,
  MiraklImportStatus,
} from '../../domain/types/mirakl-import.types';

export interface IMiraklImportTracker {
  /**
   * One status read. Never waits and never loops: Mirakl allows a status call
   * about once a minute per import kind, so pacing belongs to the job that
   * calls this.
   */
  getStatus(kind: MiraklImportKind, importId: string): Promise<MiraklImportStatus>;

  /** The failed lines of an import. Empty when the report lists none. */
  getErrorReport(kind: MiraklImportKind, importId: string): Promise<MiraklImportLineError[]>;

  /**
   * The failed lines of a product (P41) import, from both of its reports:
   * the transformation errors (P47) and the integration errors (P44). A line
   * is named by the first of `keyColumns` the report carries.
   */
  getProductErrorReports(
    importId: string,
    status: MiraklImportStatus,
    keyColumns: readonly string[]
  ): Promise<MiraklImportLineError[]>;
}

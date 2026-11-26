/**
 * Mirakl HTTP Client Port
 *
 * The transport contract every Mirakl adapter codes against, so adapter specs
 * can stub HTTP without a real `fetch`. Package-private: not exported from the
 * package barrel.
 *
 * @module libs/integrations/mirakl/src/infrastructure/http
 */
import type {
  MiraklFileUpload,
  MiraklHttpResponse,
  MiraklRequestOptions,
} from './mirakl-http-client.types';

export interface IMiraklHttpClient {
  /** GET a JSON resource. Retried on 5xx and transport failures. */
  get<T>(path: string, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<T>>;

  /**
   * GET a text resource verbatim. Import error reports come back as CSV, not
   * JSON. Retried like `get`.
   */
  getText(path: string, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<string>>;

  /** POST a JSON body. Not retried on 5xx/transport unless `idempotent`. */
  post<T>(path: string, body?: unknown, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<T>>;

  /** PUT a JSON body (OR21 accept, OR23 tracking, OR24 ship). Retried. */
  put<T>(path: string, body?: unknown, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<T>>;

  /**
   * POST one file as `multipart/form-data` (STO01, PRI01, P41, OF01). Never
   * retried on 5xx or a transport failure, whatever `idempotent` says: Mirakl
   * may already have queued the import, and a second submit could apply it
   * twice. A 429 is still retried, since Mirakl refused it before reading it.
   */
  postFile<T>(
    path: string,
    file: MiraklFileUpload,
    options?: MiraklRequestOptions,
  ): Promise<MiraklHttpResponse<T>>;
}

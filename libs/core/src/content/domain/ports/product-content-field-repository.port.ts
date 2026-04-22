/**
 * Product Content Field Repository Port
 *
 * Persistence contract for `ProductContentField` rows. Methods cover the
 * read/write shapes the application service needs — no broader CRUD surface
 * (no findAll, no pagination) until a real consumer asks for it.
 *
 * @module libs/core/src/content/domain/ports
 */
import type { ProductContentField } from '../entities/product-content-field.entity';
import type { FieldKey } from '../types/content.types';

/**
 * Lookup key for a single content field row. `connectionId === null` means
 * the master (platform-agnostic) row.
 */
export interface ProductContentFieldKey {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
}

/**
 * Upsert payload — a complete row state. The repository is responsible for
 * inserting when no row matches the key, or updating in place when one does.
 * Callers always pass the post-mutation state, never partial diffs.
 */
export interface ProductContentFieldUpsert {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
  draftValue: string | null;
  baseValue: string | null;
  baseVersion: string | null;
  hasConflict: boolean;
  updatedBy: string | null;
}

export interface ProductContentFieldRepositoryPort {
  findByKey(key: ProductContentFieldKey): Promise<ProductContentField | null>;
  upsert(payload: ProductContentFieldUpsert): Promise<ProductContentField>;
  delete(key: ProductContentFieldKey): Promise<void>;
}

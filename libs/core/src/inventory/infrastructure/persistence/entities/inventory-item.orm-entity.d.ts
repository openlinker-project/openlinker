import { ProductOrmEntity } from '@openlinker/core/products/infrastructure/persistence/entities/product.orm-entity';
import { ProductVariantOrmEntity } from '@openlinker/core/products/infrastructure/persistence/entities/product-variant.orm-entity';
export declare class InventoryItemOrmEntity {
    id: string;
    productId: string;
    product: ProductOrmEntity;
    productVariantId: string | null;
    productVariant: ProductVariantOrmEntity | null;
    availableQuantity: number;
    reservedQuantity: number;
    locationId: string | null;
    updatedAt: Date;
}
//# sourceMappingURL=inventory-item.orm-entity.d.ts.map
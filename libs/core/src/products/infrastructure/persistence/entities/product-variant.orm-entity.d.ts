import { ProductOrmEntity } from './product.orm-entity';
export declare class ProductVariantOrmEntity {
    id: string;
    productId: string;
    product: ProductOrmEntity;
    sku: string | null;
    attributes: Record<string, string> | null;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=product-variant.orm-entity.d.ts.map
export type ProductStatus =
  | 'pending'
  | 'active'
  | 'discontinued'
  | 'hidden'
  | 'merged'
  | 'rejected';

export interface Product {
  id: string;
  categoryId: string;
  brandId: string | null;
  name: string;
  normalizedName: string;
  modelCode: string | null;
  officialUrl: string | null;
  status: ProductStatus;
  mergedIntoProductId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

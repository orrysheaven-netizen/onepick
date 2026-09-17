export interface Brand {
  id: string;
  name: string;
  normalizedName: string;
  slug: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

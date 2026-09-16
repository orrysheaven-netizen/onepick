import type { Database } from '@/lib/supabase/database.types';
import type { Brand } from '@/types/domain/brand';

type BrandRow = Database['public']['Tables']['brands']['Row'];

export function mapBrandRow(row: BrandRow): Brand {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    slug: row.slug,
    logoUrl: row.logo_url,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

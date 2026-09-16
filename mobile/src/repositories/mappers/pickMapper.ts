import type { Database } from '@/lib/supabase/database.types';
import type { Pick, PickStatus } from '@/types/domain/pick';

type PickRow = Database['public']['Tables']['picks']['Row'];

export function mapPickRow(row: PickRow): Pick {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    productId: row.product_id,
    oneLineReview: row.one_line_review,
    status: row.status as PickStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    replacedByPickId: row.replaced_by_pick_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

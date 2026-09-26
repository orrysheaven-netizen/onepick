import type { Database } from '@/lib/supabase/database.types';
import type { Pick, PickStatus } from '@/types/domain/pick';

type PickRow = Database['public']['Tables']['picks']['Row'];
type PickLikeRow = Omit<PickRow, 'channel'> & { channel?: string | null };

export function mapPickRow(row: PickLikeRow): Pick {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    itemId: row.item_id,
    oneLineReview: row.one_line_review,
    channel: (row.channel as Pick['channel']) ?? null,
    purchaseUrl: row.purchase_url ?? null,
    purchaseTip: row.purchase_tip ?? null,
    status: row.status as PickStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    replacedByPickId: row.replaced_by_pick_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

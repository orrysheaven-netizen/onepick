import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type {
  ChangePickInput,
  PickRepository,
  PurchaseLinkInput,
  RecentPicksInput,
  UpdatePickReviewInput,
  RegisterPickRecordInput,
} from '@/repositories/interfaces/pickRepository';
import { mapPickRow } from '@/repositories/mappers/pickMapper';

// An omitted argument is not the same as an empty one. The RPC keeps what is
// stored when a field is absent and clears it on '', so a caller that only
// edits the review never wipes a link the person saved earlier.
function purchaseArgs(input: PurchaseLinkInput) {
  return {
    ...(input.purchaseUrl === undefined ? {} : { p_purchase_url: input.purchaseUrl }),
    ...(input.purchaseTip === undefined ? {} : { p_purchase_tip: input.purchaseTip }),
  };
}

export class SupabasePickRepository implements PickRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async registerPick(input: RegisterPickRecordInput) {
    const { data, error } = await this.client.rpc('register_pick', {
      p_category_id: input.categoryId, p_item_id: input.itemId,
      p_item_name: input.itemName, p_one_line_review: input.oneLineReview,
      p_image_path: input.imagePath, p_thumbnail_path: input.thumbnailPath,
      p_image_source_url: input.imageSourceUrl,
      ...(input.channel ? { p_channel: input.channel } : {}),
    });
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('INTERNAL_ERROR');
    return mapPickRow(data);
  }

  async getById(pickId: string) {
    const { data, error } = await this.client
      .from('picks')
      .select('*')
      .eq('id', pickId)
      .maybeSingle();

    if (error) {
      throw mapSupabaseError(error);
    }

    return data ? mapPickRow(data) : null;
  }

  async getCurrentPick(userId: string, categoryId: string) {
    const { data, error } = await this.client
      .from('picks')
      .select('*')
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .in('status', ['active', 'needs_review'])
      .maybeSingle();

    if (error) {
      throw mapSupabaseError(error);
    }

    return data ? mapPickRow(data) : null;
  }

  async getActivePicksByUser(userId: string) {
    const { data, error } = await this.client
      .from('picks')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false });

    if (error) {
      throw mapSupabaseError(error);
    }

    return data.map(mapPickRow);
  }

  async getCurrentPicksByUser(userId: string) {
    const { data, error } = await this.client
      .from('picks')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'needs_review'])
      .order('updated_at', { ascending: false });

    if (error) {
      throw mapSupabaseError(error);
    }

    return data.map(mapPickRow);
  }

  async getHistoryByUser(userId: string, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const { data, error } = await this.client
      .from('picks')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['replaced', 'removed', 'hidden'])
      .order('started_at', { ascending: false })
      .limit(safeLimit);

    if (error) {
      throw mapSupabaseError(error);
    }

    return data.map(mapPickRow);
  }

  async getRecentPicks(input: RecentPicksInput) {
    const limit = Math.min(Math.max(input.limit, 1), 100);

    let query = this.client
      .from('picks')
      .select('*')
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (input.excludeUserId) {
      query = query.neq('user_id', input.excludeUserId);
    }

    if (input.categoryId) {
      query = query.eq('category_id', input.categoryId);
    }

    if (input.itemId) {
      query = query.eq('item_id', input.itemId);
    }

    const { data, error } = await query;

    if (error) {
      throw mapSupabaseError(error);
    }

    return data.map(mapPickRow);
  }

  async changePick(input: ChangePickInput) {
    const { data, error } = await this.client.rpc('change_pick', {
      p_category_id: input.categoryId,
      p_item_id: input.itemId,
      p_one_line_review: input.oneLineReview,
      // Omitted arguments leave the stored link and tip alone; '' clears them.
      ...purchaseArgs(input),
      ...(input.channel ? { p_channel: input.channel } : {}),
    });

    if (error) {
      throw mapSupabaseError(error);
    }

    if (!data) {
      throw new AppError('INTERNAL_ERROR');
    }

    return mapPickRow(data);
  }

  async updateReview(input: UpdatePickReviewInput) {
    const { data, error } = await this.client.rpc('update_pick_review', {
      p_pick_id: input.pickId,
      p_one_line_review: input.oneLineReview,
      ...purchaseArgs(input),
    });

    if (error) {
      throw mapSupabaseError(error);
    }

    if (!data) {
      throw new AppError('INTERNAL_ERROR');
    }

    return mapPickRow(data);
  }

  async removePick(categoryId: string) {
    const { error } = await this.client.rpc('remove_pick', {
      p_category_id: categoryId,
    });

    if (error) {
      throw mapSupabaseError(error);
    }
  }
}

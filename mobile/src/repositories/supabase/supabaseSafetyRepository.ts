import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { SafetyRepository, SubmitReportInput } from '@/repositories/interfaces/safetyRepository';
import type { ContentReport, UserBlock } from '@/types/domain/safety';

function mapBlock(row: any): UserBlock {
  return {
    blockerUserId: row.blocker_user_id,
    blockedUserId: row.blocked_user_id,
    blockedUsername: row.blocked_username_snapshot,
    createdAt: row.created_at,
  };
}

function mapReport(row: any): ContentReport {
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetUserId: row.target_user_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseSafetyRepository implements SafetyRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  private async assertUser(userId: string) {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw mapSupabaseError(error);
    if (!data.user) throw new AppError('AUTH_REQUIRED');
    if (data.user.id !== userId) throw new AppError('FORBIDDEN');
  }

  async getBlocks(userId: string) {
    await this.assertUser(userId);
    const db = this.client as any;
    const { data, error } = await db
      .from('user_blocks')
      .select('*')
      .eq('blocker_user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw mapSupabaseError(error);
    return (data ?? []).map(mapBlock);
  }

  async blockUser(blockerUserId: string, blockedUserId: string) {
    await this.assertUser(blockerUserId);
    const db = this.client as any;
    const { data, error } = await db
      .from('user_blocks')
      .insert({
        blocker_user_id: blockerUserId,
        blocked_user_id: blockedUserId,
        blocked_username_snapshot: 'pending',
      })
      .select('*')
      .single();
    if (error) throw mapSupabaseError(error);
    return mapBlock(data);
  }

  async unblockUser(blockerUserId: string, blockedUserId: string) {
    await this.assertUser(blockerUserId);
    const db = this.client as any;
    const { error } = await db
      .from('user_blocks')
      .delete()
      .eq('blocker_user_id', blockerUserId)
      .eq('blocked_user_id', blockedUserId);
    if (error) throw mapSupabaseError(error);
  }

  async submitReport(input: SubmitReportInput) {
    await this.assertUser(input.reporterUserId);
    const db = this.client as any;
    const { data, error } = await db
      .from('content_reports')
      .insert({
        reporter_user_id: input.reporterUserId,
        target_type: input.targetType,
        target_id: input.targetId,
        reason: input.reason,
        details: input.details ?? null,
      })
      .select('*')
      .single();
    if (error?.code === '23505') throw new AppError('REPORT_DUPLICATE', 'REPORT_DUPLICATE', error);
    if (error) throw mapSupabaseError(error);
    return mapReport(data);
  }
}

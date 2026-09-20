import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import type { SubmitReportInput } from '@/repositories/interfaces/safetyRepository';
import { safetyService } from '@/services';
import type { ReportStatus } from '@/types/domain/safety';

async function invalidateSafetyVisibility(client: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.safety.all }),
    client.invalidateQueries({ queryKey: queryKeys.follows.all }),
    client.invalidateQueries({ queryKey: queryKeys.home.all }),
    client.invalidateQueries({ queryKey: queryKeys.explore.all }),
    client.invalidateQueries({ queryKey: queryKeys.profiles.all }),
    client.invalidateQueries({ queryKey: queryKeys.picks.all }),
    client.invalidateQueries({ queryKey: queryKeys.comments.all }),
  ]);
}

export function useBlockedUsers(userId?: string) {
  return useQuery({
    queryKey: userId ? queryKeys.safety.blocks(userId) : ['safety', 'blocks', 'missing'],
    queryFn: () => safetyService.getBlocks(userId!),
    enabled: Boolean(userId),
    retry: false,
  });
}

export function useSafetyActions() {
  const client = useQueryClient();

  const blockUser = useMutation({
    mutationFn: ({ blockerUserId, blockedUserId }: { blockerUserId: string; blockedUserId: string }) =>
      safetyService.blockUser(blockerUserId, blockedUserId),
    onSuccess: () => invalidateSafetyVisibility(client),
  });

  const unblockUser = useMutation({
    mutationFn: ({ blockerUserId, blockedUserId }: { blockerUserId: string; blockedUserId: string }) =>
      safetyService.unblockUser(blockerUserId, blockedUserId),
    onSuccess: () => invalidateSafetyVisibility(client),
  });

  const submitReport = useMutation({
    mutationFn: (input: SubmitReportInput) => safetyService.submitReport(input),
  });

  return { blockUser, unblockUser, submitReport };
}

export function useAdminReports(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.safety.reports,
    queryFn: () => safetyService.getReports(300),
    enabled,
    retry: false,
  });
}

export function useAdminReportActions() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ reportId, status }: { reportId: string; status: ReportStatus }) =>
      safetyService.updateReportStatus(reportId, status),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.safety.reports }),
  });
}

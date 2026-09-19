import { useQuery } from '@tanstack/react-query';
import { profileAiStatusService } from '@/services/profileAiStatusService';

/** Public health/contract read. It changes rarely and is rechecked immediately
 * before generation, so profile screens share a short cache instead of polling. */
export function useProfileAiStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['profile-ai-service-status'] as const,
    queryFn: ({ signal }) => profileAiStatusService.get(signal),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
}

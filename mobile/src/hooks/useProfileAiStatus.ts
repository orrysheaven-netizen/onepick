import { useQuery } from '@tanstack/react-query';
import { profileAiStatusService } from '@/services/profileAiStatusService';

/** Public health read; never makes a generation request or reads a profile. */
export function useProfileAiStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['profile-ai-service-status'] as const,
    queryFn: ({ signal }) => profileAiStatusService.get(signal),
    enabled,
    retry: false,
    staleTime: 15_000,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
}

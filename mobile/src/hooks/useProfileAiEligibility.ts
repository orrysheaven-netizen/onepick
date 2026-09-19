import { useQuery } from '@tanstack/react-query';
import { profileAiEligibilityService } from '@/services/profileAiEligibilityService';

/** Display eligibility from public reads, not the owner's more permissive list.
 * The old list count is only a refresh hint, never the displayed/authorized count.
 * A generation click always performs a fresh preflight, so idle polling is not
 * needed merely to keep the button safe. */
export function useProfileAiEligibility(profileId: string, enabled: boolean, listCountHint: number) {
  return useQuery({
    queryKey: ['profiles', 'ai-eligibility', profileId,
      Number.isSafeInteger(listCountHint) && listCountHint >= 0 ? listCountHint : 0] as const,
    queryFn: ({ signal }) => profileAiEligibilityService.get(profileId, signal),
    enabled: enabled && Boolean(profileId),
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
}

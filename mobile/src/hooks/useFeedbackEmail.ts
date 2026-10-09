import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { feedbackEmailRepository } from '@/repositories/supabase/feedbackEmailRepository';

const feedbackEmailKey = ['public-settings', 'feedback-email'] as const;

export function useFeedbackEmail() {
  return useQuery({
    queryKey: feedbackEmailKey,
    queryFn: () => feedbackEmailRepository.get(),
    staleTime: 60_000,
    retry: false,
  });
}

export function useSaveFeedbackEmail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (email: string | null) => feedbackEmailRepository.set(email),
    onSuccess: (email) => { client.setQueryData(feedbackEmailKey, email); },
  });
}

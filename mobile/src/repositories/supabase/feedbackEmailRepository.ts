import { supabase, type AppSupabaseClient } from '@/lib/supabase/client';
import { normalizeFeedbackEmail } from '@/lib/feedback/email';

export function createFeedbackEmailRepository(client: AppSupabaseClient) {
  return {
    async get(): Promise<string | null> {
      const { data, error } = await client.from('home_settings').select('feedback_email').eq('id', true).single();
      if (error) throw error;
      return normalizeFeedbackEmail(data.feedback_email);
    },
    async set(value: string | null): Promise<string | null> {
      const email = normalizeFeedbackEmail(value);
      // UPDATE only: never upsert a missing singleton or report a zero-row RLS update as success.
      const { data, error } = await client.from('home_settings').update({ feedback_email: email })
        .eq('id', true).select('feedback_email').single();
      if (error) throw error;
      return normalizeFeedbackEmail(data.feedback_email);
    },
  };
}

export const feedbackEmailRepository = createFeedbackEmailRepository(supabase);

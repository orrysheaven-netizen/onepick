import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type {
  CaptureClientErrorInput,
  CaptureProductEventInput,
  ObservabilityRepository,
} from '@/repositories/interfaces/observabilityRepository';

export class SupabaseObservabilityRepository implements ObservabilityRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async captureClientError(input: CaptureClientErrorInput) {
    const { data, error: authError } = await this.client.auth.getUser();
    if (authError) throw mapSupabaseError(authError);
    if (!data.user) return;

    const table = this.client.from as unknown as (name: 'client_error_events') => any;
    const { error } = await table('client_error_events').insert({
      user_id: data.user.id,
      context: input.context,
      error_code: input.errorCode,
      platform: input.platform ?? null,
      app_version: input.appVersion ?? null,
    });

    if (error) throw mapSupabaseError(error);
  }

  async captureProductEvent(input: CaptureProductEventInput) {
    const { error } = await this.client.rpc('capture_product_event', {
      p_event_name: input.eventName,
      p_pick_id: input.pickId ?? null,
      p_item_id: input.itemId ?? null,
      p_category_id: input.categoryId ?? null,
      p_source: input.source ?? null,
      p_path: input.path ?? null,
      p_platform: input.platform ?? null,
      p_app_version: input.appVersion ?? null,
    });

    if (error) throw mapSupabaseError(error);
  }
}

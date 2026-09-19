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
    const table = this.client.from as unknown as (name: 'product_analytics_events') => any;
    const { error } = await table('product_analytics_events').insert({
      event_name: input.eventName,
      pick_id: input.pickId ?? null,
      item_id: input.itemId ?? null,
      category_id: input.categoryId ?? null,
      source: input.source ?? null,
      path: input.path ?? null,
      platform: input.platform ?? null,
      app_version: input.appVersion ?? null,
    });

    if (error) throw mapSupabaseError(error);
  }
}

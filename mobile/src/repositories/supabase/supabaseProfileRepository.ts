import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  ProfileRepository,
  UpdateProfileInput,
} from '@/repositories/interfaces/profileRepository';
import { mapProfileRow } from '@/repositories/mappers/profileMapper';

type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export class SupabaseProfileRepository implements ProfileRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async getById(userId: string) {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw mapSupabaseError(error);
    }

    return data ? mapProfileRow(data) : null;
  }

  async getByUsername(username: string) {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('username', username.trim().toLowerCase())
      .maybeSingle();

    if (error) {
      throw mapSupabaseError(error);
    }

    return data ? mapProfileRow(data) : null;
  }

  async update(input: UpdateProfileInput) {
    const {
      data: { user },
      error: authError,
    } = await this.client.auth.getUser();

    if (authError) {
      throw mapSupabaseError(authError);
    }

    if (!user) {
      throw new AppError('AUTH_REQUIRED');
    }

    const values: ProfileUpdate = {};

    if (input.username !== undefined) {
      values.username = input.username.trim().toLowerCase();
    }

    if (input.bio !== undefined) {
      values.bio = input.bio;
    }

    if (input.profileImageUrl !== undefined) {
      values.profile_image_url = input.profileImageUrl;
    }

    if (Object.keys(values).length === 0) {
      const current = await this.getById(user.id);

      if (!current) {
        throw new AppError('PROFILE_NOT_FOUND');
      }

      return current;
    }

    const { data, error } = await this.client
      .from('profiles')
      .update(values)
      .eq('id', user.id)
      .select('*')
      .single();

    if (error) {
      throw mapSupabaseError(error);
    }

    return mapProfileRow(data);
  }
}

import type { Profile } from '@/types/domain/profile';

export interface CreateProfileInput {
  username: string;
}

export interface UpdateProfileInput {
  username?: string;
  bio?: string | null;
  profileImageUrl?: string | null;
}

export interface ProfileRepository {
  getById(userId: string): Promise<Profile | null>;
  getByUsername(username: string): Promise<Profile | null>;
  create(input: CreateProfileInput): Promise<Profile>;
  update(input: UpdateProfileInput): Promise<Profile>;
}

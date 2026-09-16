import type { Profile } from '@/types/domain/profile';

export interface UpdateProfileInput {
  username?: string;
  bio?: string | null;
  profileImageUrl?: string | null;
}

export interface ProfileRepository {
  getById(userId: string): Promise<Profile | null>;
  getByUsername(username: string): Promise<Profile | null>;
  update(input: UpdateProfileInput): Promise<Profile>;
}

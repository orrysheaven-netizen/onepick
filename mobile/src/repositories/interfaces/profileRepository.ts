import type { Profile } from '@/types/domain/profile';

export interface CreateProfileInput {
  username: string;
  /** Optional originating account; verified against auth before insertion. */
  expectedUserId?: string;
}

export interface UpdateProfileInput {
  username?: string;
  bio?: string | null;
  profileImageUrl?: string | null;
}

export interface ProfileRepository {
  getById(userId: string): Promise<Profile | null>;
  // Returns visible profiles for unique IDs; missing profiles are omitted and order is unspecified.
  getByIds(userIds: string[]): Promise<Profile[]>;
  getByUsername(username: string): Promise<Profile | null>;
  create(input: CreateProfileInput): Promise<Profile>;
  update(input: UpdateProfileInput): Promise<Profile>;
}

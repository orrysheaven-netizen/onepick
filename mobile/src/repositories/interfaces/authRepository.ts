import type { AuthUser } from '@/types/domain/auth';

export interface AuthRepository {
  getCurrentUser(): Promise<AuthUser | null>;
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  signInWithKakao(): Promise<void>;
  completeOAuthFromUrl(url: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

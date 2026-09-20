import type { AuthUser, SocialAuthProvider } from '@/types/domain/auth';

export interface AuthRepository {
  getCurrentUser(): Promise<AuthUser | null>;
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  signInWithProvider(provider: SocialAuthProvider, redirectTo: string): Promise<AuthUser | null>;
  signInWithKakao(redirectTo: string): Promise<AuthUser | null>;
  completeOAuthFromUrl(url: string): Promise<AuthUser | null>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

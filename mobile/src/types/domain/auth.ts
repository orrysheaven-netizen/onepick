export type SocialAuthProvider = 'kakao' | 'apple';

export interface AuthUser {
  id: string;
  email: string | null;
}

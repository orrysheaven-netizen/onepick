export type SocialAuthProvider = 'kakao' | 'google' | 'naver';

export interface AuthUser {
  id: string;
  email: string | null;
}

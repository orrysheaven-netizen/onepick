export interface Profile {
  id: string;
  username: string;
  nickname: string | null;
  profileImageUrl: string | null;
  bio: string | null;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

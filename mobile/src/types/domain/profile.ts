export interface Profile {
  id: string;
  username: string;
  profileImageUrl: string | null;
  bio: string | null;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

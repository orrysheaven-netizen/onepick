export interface Profile {
  id: string;
  username: string;
  /**
   * Public nickname (#804). Optional and separate from the unique username; the
   * read model fills it once nickname storage ships. Screens never read it directly:
   * use lib/profile/profileName so an unset nickname falls back to the username.
   */
  nickname?: string | null;
  profileImageUrl: string | null;
  bio: string | null;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SystemActor {
  id: string;
  slug: string;
  displayName: string;
  actorType: 'ai';
  bio: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileAiReview {
  id: string;
  profileId: string;
  actorId: string;
  summary: string;
  body: string;
  keywords: string[];
  isVisible: boolean;
  isStale: boolean;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  actor: SystemActor;
}

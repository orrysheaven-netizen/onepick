import type { ProfileAiTone } from '@/lib/profileAiTone';

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
  /** NULL is an older comment with no selected tone; never relabel it as T/F. */
  tone: ProfileAiTone | null;
  isVisible: boolean;
  isStale: boolean;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
  actor: SystemActor;
}

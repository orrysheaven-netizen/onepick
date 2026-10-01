export type ReportTargetType = 'profile' | 'pick' | 'comment';
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'misleading' | 'other';
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export interface UserBlock {
  blockerUserId: string;
  blockedUserId: string;
  /** null when the target was hidden from the blocker at block time (suspended or reverse-blocked). */
  blockedUsername: string | null;
  createdAt: string;
}

export interface FollowCounts {
  followingCount: number;
  followerCount: number;
}

export type FollowConnectionDirection = 'followers' | 'following';

export interface FollowConnectionCursor {
  username: string;
  userId: string;
}

export interface FollowConnection {
  userId: string;
  username: string;
  profileImageUrl: string | null;
  bio: string | null;
  viewerIsFollowing: boolean;
}

export interface FollowConnectionPage {
  items: FollowConnection[];
  nextCursor: FollowConnectionCursor | null;
}

export interface ContentReport {
  id: string;
  reporterUserId: string | null;
  reporterUsername?: string | null;
  targetType: ReportTargetType;
  targetId: string;
  targetUserId: string | null;
  targetUsername?: string | null;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

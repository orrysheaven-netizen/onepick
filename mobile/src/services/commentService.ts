import { AppError } from '@/errors/appError';
import type {
  CommentRepository,
  UpdateCommentInput,
} from '@/repositories/interfaces/commentRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';
import type { ReadCursor, ReadRepository } from '@/repositories/interfaces/readRepository';

const MAX_COMMENT_LENGTH = 300;
export const COMMENTS_PAGE_SIZE = 20;

function normalizeBody(value: string) {
  const body = value.trim();
  if (body.length < 1 || body.length > MAX_COMMENT_LENGTH) throw new AppError('COMMENT_INVALID');
  return body;
}

export class CommentService {
  constructor(
    private readonly commentRepository: CommentRepository,
    private readonly pickRepository: PickRepository,
    private readonly profileRepository: ProfileRepository,
    private readonly readRepository: ReadRepository,
  ) {}

  async getComments(pickId: string, cursor: ReadCursor | null = null, limit = COMMENTS_PAGE_SIZE) {
    const pageSize = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 99) : COMMENTS_PAGE_SIZE;
    const rows = await this.readRepository.getCommentsByPickId(pickId, pageSize + 1, cursor);
    const items = rows.slice(0, pageSize);
    const last = items[items.length - 1]?.comment;
    return {
      items,
      nextCursor: rows.length > pageSize && last ? { timestamp: last.createdAt, id: last.id } : null,
    };
  }

  locateComment(commentId: string) {
    if (!commentId) return Promise.resolve(null);
    return this.readRepository.locateComment(commentId);
  }

  async createComment(input: { pickId: string; userId: string; body: string; parentCommentId?: string | null }) {
    const body = normalizeBody(input.body);
    const profile = await this.profileRepository.getById(input.userId);
    if (!profile) throw new AppError('PROFILE_NOT_FOUND');

    // Do not preflight Pick status here. The server/RLS owns the current
    // same-item+channel-or-review-author rule, including ended reviews.
    const comment = await this.commentRepository.create({
      pickId: input.pickId,
      userId: input.userId,
      body,
      parentCommentId: input.parentCommentId ?? null,
    });
    return { comment, author: profile };
  }

  updateComment(input: UpdateCommentInput) {
    return this.commentRepository.update({ ...input, body: normalizeBody(input.body) });
  }

  removeComment(commentId: string) {
    return this.commentRepository.remove(commentId);
  }
}

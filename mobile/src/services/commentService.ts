import { AppError } from '@/errors/appError';
import type {
  CommentRepository,
  UpdateCommentInput,
} from '@/repositories/interfaces/commentRepository';
import type { PickRepository } from '@/repositories/interfaces/pickRepository';
import type { ProfileRepository } from '@/repositories/interfaces/profileRepository';
import type { ReadRepository } from '@/repositories/interfaces/readRepository';

const MAX_COMMENT_LENGTH = 300;

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

  async getComments(pickId: string) {
    const pick = await this.pickRepository.getById(pickId);
    if (!pick) throw new AppError('PICK_NOT_FOUND');
    return this.readRepository.getCommentsByPickId(pickId, 100);
  }

  async createComment(input: { pickId: string; userId: string; body: string }) {
    const body = normalizeBody(input.body);
    const [pick, profile] = await Promise.all([
      this.pickRepository.getById(input.pickId),
      this.profileRepository.getById(input.userId),
    ]);
    if (!pick) throw new AppError('PICK_NOT_FOUND');
    if (pick.status !== 'active') throw new AppError('FORBIDDEN');
    if (!profile) throw new AppError('PROFILE_NOT_FOUND');

    const comment = await this.commentRepository.create({
      pickId: input.pickId,
      userId: input.userId,
      body,
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

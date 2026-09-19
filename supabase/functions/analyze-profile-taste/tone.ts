/** Presentation modes only. Never infer, store or label a user's MBTI. */
export type TasteTone = 'direct' | 'warm';
export const TASTE_TONE_VERSION = 'tone-v1';

export function requireTasteTone(value: unknown): TasteTone {
  if (value !== 'direct' && value !== 'warm') throw new Error('AI_TONE_INVALID');
  return value;
}

export function tastePromptVersion(base: string, value: unknown): string {
  const result = `${base}:${requireTasteTone(value)}:${TASTE_TONE_VERSION}`;
  if (result.length > 40 || base.includes(':')) throw new Error('AI_TONE_INVALID');
  return result;
}

export function tasteInstructions(base: string, value: unknown): string {
  const tone = requireTasteTone(value);
  const common = '\n\n[이번 댓글의 전달 방식]\n이 선택은 사용자가 이번 요청에서 고른 말투일 뿐 MBTI나 성격의 증거가 아닙니다. 사용자를 T형·F형으로 부르거나 논리적인 사람·감정적인 사람으로 분류하지 마세요. 선택 이유와 공통점을 읽는 기준은 두 말투에서 같습니다. 말투를 위해 사실이나 근거를 바꾸지 마세요. 위의 근거·나이 제외·존중·안전 규칙을 완화하지 마세요. 말투나 MBTI에 대한 해명 대신 댓글을 바로 쓰세요.\n';
  return base + common + (tone === 'direct'
    ? '담백한 해석: 핵심 관찰을 먼저 말하고, 서로 다른 원픽의 구체적인 이유를 연결한 뒤 짧게 정리하세요. 문장은 간결하고 또렷한 존댓말을 씁니다. 솔직함은 근거를 분명히 밝힌다는 뜻이지 결점 찾기·독설·평가 점수가 아닙니다. 근거가 충분할 때만 선택의 조합을 소재로 짧고 건조한 위트를 한 문장 넣으세요. 없는 단점을 만들거나 사용자를 비판하지 마세요.'
    : '다정한 해석: 사용자가 적은 장면·맛·사용감을 구체적으로 살펴보며, 선택 사이의 연결을 부드러운 존댓말로 풀어주세요. 다정함은 존중하는 표현이지 과장된 칭찬이나 특별함의 증명이 아닙니다. 제공되지 않은 감정·관계·생활사를 지어내거나 위로받아야 할 사람으로 취급하지 마세요. 근거가 충분할 때만 선택의 조합을 다정한 비유로 한 문장 표현하세요. 과도한 애교나 친밀한 호칭은 쓰지 마세요.');
}

/** Bound untrusted JSON before selecting a fixed server-owned instruction block. */
export async function readTasteTone(req: Request): Promise<TasteTone> {
  if (!req.body) throw new Error('AI_TONE_INVALID');
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) throw new Error('AI_TONE_INVALID');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('AI_TONE_INVALID');
    return requireTasteTone((body as Record<string, unknown>).tone);
  };
  try {
    return await Promise.race([read(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('AI_TONE_INVALID')), 3000);
    })]);
  } catch { throw new Error('AI_TONE_INVALID'); }
  finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A cancelled read may still be settling. */ }
  }
}

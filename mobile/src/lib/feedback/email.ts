// One unquoted public mailbox, not a mailto URL, display name or recipient list.
// Match the database CHECK; encode the address too so ?, #, &, % cannot add headers.
const EMAIL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function normalizeFeedbackEmail(value: string | null): string | null {
  const email = value?.trim() ?? '';
  if (!email) return null;
  if (email.length > 254 || email.split('@')[0].length > 64 || !EMAIL.test(email)) {
    throw new Error('수신할 이메일 주소 한 개를 올바르게 입력해주세요.');
  }
  return email;
}

export function feedbackMailto(value: string | null): string | null {
  const email = normalizeFeedbackEmail(value);
  return email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('원픽 의견')}` : null;
}

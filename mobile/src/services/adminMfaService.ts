import type { AppSupabaseClient } from '@/lib/supabase/client';

export class AdminMfaService {
  constructor(private readonly client: Pick<AppSupabaseClient, 'auth' | 'rpc'>) {}

  private async checkUser(userId: string) {
    const { data, error } = await this.client.auth.getUser();
    if (error || !userId || data.user?.id !== userId) throw new Error('로그인 상태가 바뀌었습니다. 다시 로그인해주세요.');
    const access = await this.client.rpc('current_user_is_admin');
    if (access.error || access.data !== true) throw new Error('관리자 계정으로 로그인해주세요.');
  }

  async status(userId: string) {
    await this.checkUser(userId);
    const factors = await this.client.auth.mfa.listFactors();
    const assurance = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (factors.error || assurance.error) throw new Error('추가 인증 상태를 확인하지 못했습니다. 다시 시도해주세요.');
    return {
      verified: factors.data.totp.filter((factor) => factor.status === 'verified'),
      pending: factors.data.all.filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified'),
      elevated: assurance.data.currentLevel === 'aal2',
    };
  }

  async enroll(userId: string) {
    const status = await this.status(userId);
    if (status.verified.length) throw new Error('이미 등록된 인증 앱으로 인증해주세요.');
    if (status.pending.length) throw new Error('이전 미완료 등록을 취소한 뒤 다시 시작해주세요.');
    const result = await this.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'OnePick 관리자', issuer: 'OnePick' });
    if (result.error) throw new Error('인증 앱 등록을 시작하지 못했습니다. 다시 시도해주세요.');
    return { id: result.data.id, secret: result.data.totp.secret, qr: result.data.totp.qr_code };
  }

  async verify(userId: string, factorId: string, code: string) {
    if (!/^\d{6}$/.test(code)) throw new Error('인증 앱에 표시된 6자리 숫자를 입력해주세요.');
    await this.checkUser(userId);
    const result = await this.client.auth.mfa.challengeAndVerify({ factorId, code });
    if (result.error) throw new Error('인증하지 못했습니다. 최신 번호와 휴대폰 시간을 확인한 뒤 잠시 후 다시 시도해주세요.');
    const status = await this.status(userId);
    if (!status.elevated) throw new Error('인증 상태를 다시 확인해주세요.');
    return status;
  }

  async cancelPending(userId: string, factorId: string) {
    const status = await this.status(userId);
    if (!status.pending.some((factor) => factor.id === factorId)) throw new Error('미완료 등록만 취소할 수 있습니다. 상태를 다시 확인해주세요.');
    const result = await this.client.auth.mfa.unenroll({ factorId });
    if (result.error) throw new Error('등록을 취소하지 못했습니다. 다시 시도해주세요.');
  }
}

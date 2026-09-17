import type { AppSupabaseClient } from '@/lib/supabase/client';

export function enrollmentError(error: { code?: string; status?: number }) {
  switch (error.code) {
    case 'mfa_totp_enroll_not_enabled': return '서버에서 인증 앱 등록이 꺼져 있습니다. 운영 설정을 확인해야 합니다.';
    case 'mfa_factor_name_conflict': return '같은 이름의 인증 등록이 있습니다. 상태를 다시 확인해주세요.';
    case 'too_many_enrolled_mfa_factors': return '인증 등록 개수가 가득 찼습니다. 미완료 등록을 정리해주세요.';
    case 'over_request_rate_limit': return '요청이 많습니다. 잠시 후 다시 시도해주세요.';
    case 'reauthentication_needed':
    case 'session_expired': return '다시 로그인한 뒤 인증 앱을 등록해주세요.';
    default: {
      // Codes contain no account/credential data. Never display raw Auth errors.
      const code = error.code && /^[a-z_]{1,64}$/.test(error.code) ? error.code : error.status && error.status >= 500 ? 'server_error' : 'connection_error';
      return `인증 앱 등록을 시작하지 못했습니다. 오류 코드: ${code}`;
    }
  }
}

export class AdminMfaService {
  constructor(private readonly client: Pick<AppSupabaseClient, 'auth' | 'rpc'>) {}

  private async checkUser(userId: string) {
    const { data, error } = await this.client.auth.getUser();
    if (error || !userId || data.user?.id !== userId) throw new Error('로그인 상태가 바뀌었습니다. 다시 로그인해주세요.');
    const access = await this.client.rpc('current_user_is_admin');
    if (access.error || access.data !== true) throw new Error('관리자 계정으로 로그인해주세요.');
    return data.user;
  }

  async status(userId: string) {
    const user = await this.checkUser(userId);
    const factors = await this.client.auth.mfa.listFactors();
    const assurance = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (factors.error || assurance.error) throw new Error('추가 인증 상태를 확인하지 못했습니다. 다시 시도해주세요.');
    return {
      emailReady: Boolean(user.email?.trim() && user.email_confirmed_at),
      verified: factors.data.totp.filter((factor) => factor.status === 'verified'),
      pending: factors.data.all.filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified'),
      elevated: assurance.data.currentLevel === 'aal2',
    };
  }

  async enroll(userId: string) {
    const status = await this.status(userId);
    if (!status.emailReady) throw new Error('인증 앱을 등록하려면 먼저 관리자 이메일을 연결하고 확인해주세요.');
    if (status.verified.length) throw new Error('이미 등록된 인증 앱으로 인증해주세요.');
    if (status.pending.length) throw new Error('이전 미완료 등록을 취소한 뒤 다시 시작해주세요.');
    const result = await this.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'OnePick 관리자', issuer: 'OnePick' });
    if (result.error) throw new Error(enrollmentError(result.error));
    return { id: result.data.id, secret: result.data.totp.secret, qr: result.data.totp.qr_code };
  }

  async requestEmail(userId: string, value: string, redirectTo: string) {
    const email = value.trim();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('사용할 이메일 주소를 확인해주세요.');
    const user = await this.checkUser(userId);
    // This screen only adds the missing prerequisite, never replaces an account email.
    if (user.email) throw new Error('이미 연결된 이메일이 있습니다. 이메일 확인 후 상태를 다시 확인해주세요.');
    const result = await this.client.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
    if (result.error) {
      if (result.error.code === 'over_email_send_rate_limit' || result.error.code === 'over_request_rate_limit') throw new Error('확인 메일 요청이 많습니다. 잠시 후 다시 시도해주세요.');
      if (result.error.code === 'email_address_not_authorized') throw new Error('현재 메일 발송 설정에서 이 주소로 보낼 수 없습니다. 운영자의 메일 발송 설정이 필요합니다.');
      if (result.error.code === 'email_exists') throw new Error('다른 계정에서 사용하는 이메일입니다. 다른 주소를 입력해주세요.');
      throw new Error('확인 메일을 보내지 못했습니다. 이메일 주소와 메일 발송 설정을 확인해주세요.');
    }
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

import { Alert, Platform } from 'react-native';

import { AppError } from '@/errors/appError';
import { observabilityService } from '@/services';

export function photoFailureMessage(error: unknown) {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'PHOTO_INVALID':
        return '선택한 사진을 읽을 수 없어요. 다른 이미지 파일을 선택해주세요.';
      case 'PHOTO_TOO_LARGE':
        return '사진이 서버의 최대 저장 용량을 초과했어요. 다른 사진을 선택해주세요.';
      case 'NETWORK_ERROR':
        return '인터넷 연결이 끊겼거나 불안정해 사진을 전송하지 못했어요. 연결을 확인한 뒤 다시 시도해주세요.';
      case 'FORBIDDEN':
      case 'AUTH_REQUIRED':
        return '사진 저장 권한을 확인하지 못했어요. 다시 로그인한 뒤 시도해주세요.';
      case 'RATE_LIMITED':
        return '짧은 시간에 사진 업로드 요청이 많았어요. 잠시 후 다시 시도해주세요.';
      case 'IMAGE_SOURCE_UNSUPPORTED':
        return '지원하지 않는 이미지 링크예요. 다른 링크를 사용하거나 사진을 직접 선택해주세요.';
      case 'IMAGE_IMPORT_FAILED':
        return '링크에서 사진을 가져오지 못했어요. 사이트가 이미지 가져오기를 막았거나 연결에 문제가 있을 수 있어요.';
      case 'PHOTO_UPLOAD_FAILED':
        return '사진 저장 서버가 파일을 처리하지 못했어요. 선택한 사진은 유지되니 다시 시도해주세요.';
    }
  }
  return '사진을 업로드하지 못한 원인을 확인하지 못했어요. 잠시 후 다시 시도해주세요.';
}

export function isPhotoFailure(error: unknown) {
  return error instanceof AppError && [
    'PHOTO_INVALID',
    'PHOTO_TOO_LARGE',
    'PHOTO_UPLOAD_FAILED',
    'IMAGE_SOURCE_UNSUPPORTED',
    'IMAGE_IMPORT_FAILED',
    'NETWORK_ERROR',
    'FORBIDDEN',
    'AUTH_REQUIRED',
    'RATE_LIMITED',
  ].includes(error.code);
}

const PHOTO_FAILURE_TITLE = '사진을 업로드하지 못했어요.';

export function showPhotoFailure(error: unknown, context: string) {
  void observabilityService.captureError(error, context);
  const message = photoFailureMessage(error);
  // react-native-web implements Alert.alert as a no-op, so browsers get the native dialog instead.
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(`${PHOTO_FAILURE_TITLE}\n\n${message}`);
    return;
  }
  Alert.alert(PHOTO_FAILURE_TITLE, message, [{ text: '닫기' }]);
}

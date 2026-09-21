// Social preview for a shared public profile link.
import { onProfileRequest, type PreviewContext } from '../_preview';

export const onRequestGet = (context: PreviewContext) => onProfileRequest(context);

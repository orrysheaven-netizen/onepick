// Social preview for a shared Pick link.
import { onPickRequest, type PreviewContext } from '../_preview';

export const onRequestGet = (context: PreviewContext) => onPickRequest(context);

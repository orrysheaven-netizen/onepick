export interface PickPhotoDraft {
  uri: string;
  base64: string;
  thumbnailBase64: string;
  sourceUrl?: string;
  uploadId: string;
}

export const MAX_PICK_PHOTO_BYTES = 768 * 1024;
export const MAX_THUMBNAIL_BYTES = 96 * 1024;

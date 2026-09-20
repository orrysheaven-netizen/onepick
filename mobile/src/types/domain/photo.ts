export interface PickPhotoDraft {
  uri: string;
  base64: string;
  thumbnailBase64: string;
  sourceUrl?: string;
  uploadId: string;
}

// These caps apply to the optimized JPEG payloads sent to Storage, not to the source image dimensions.
export const MAX_PICK_PHOTO_BYTES = 768 * 1024;
export const MAX_THUMBNAIL_BYTES = 96 * 1024;

import type { MediaAssetProps } from '../entities/media-asset.entity';

export interface MediaOutput {
  asset: MediaAssetProps;
  url: string | null;
  thumbnailUrl: string | null;
}

export interface UploadTicketOutput {
  mediaId: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresIn: number;
}

export const PRESIGN_GET_SECONDS = 900;

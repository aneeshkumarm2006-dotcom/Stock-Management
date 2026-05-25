// Cloudinary SDK config + helpers for PM Files storage.
//
// We use **signed direct uploads**: the browser asks our server for a signature,
// then POSTs the file straight to Cloudinary's REST endpoint. This bypasses
// Vercel's 4.5 MB serverless body limit and saves egress bandwidth.
//
// API secret never leaves the server. The cloud name is public (it's part of
// the Cloudinary URL).
import { v2 as cloudinary } from 'cloudinary';

const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

export function isCloudinaryConfigured(): boolean {
  return Boolean(cloudName && apiKey && apiSecret);
}

export interface SignedUploadParams {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
}

/**
 * Build a signed payload the browser uses to upload directly to Cloudinary.
 * The signature covers `folder` + `timestamp` (alphabetical, joined by `&`,
 * with API secret appended) — Cloudinary rejects mismatched uploads.
 */
export function signUpload(folder: string): SignedUploadParams {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary is not configured');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { folder, timestamp },
    apiSecret!,
  );
  return {
    cloudName: cloudName!,
    apiKey: apiKey!,
    timestamp,
    signature,
    folder,
  };
}

/**
 * Delete an asset by public_id. `resource_type` must match what Cloudinary
 * assigned at upload time (image|video|raw) — wrong type returns "not found".
 */
export async function destroyAsset(
  publicId: string,
  resourceType: 'image' | 'video' | 'raw',
): Promise<void> {
  if (!isCloudinaryConfigured()) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    });
  } catch (err) {
    // Swallow — we still want the Mongo row to be deleted even if the
    // remote asset is already gone. Log so we can audit orphaned assets.
    console.error('[cloudinary] destroy failed', { publicId, resourceType, err });
  }
}

// Issues a short-lived Cloudinary upload signature so the browser can POST
// the file binary directly to Cloudinary (bypassing our Next.js body limit).
//
// Caller must be an authenticated org member. The signed `folder` is scoped
// by orgId so one org's uploads never collide with another's in the bucket.
//
// Response shape matches Cloudinary's REST upload form fields the client
// needs: cloudName, apiKey, timestamp, signature, folder. The API secret is
// never exposed.
import { NextResponse } from 'next/server';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { isCloudinaryConfigured, signUpload } from '@/lib/pm/cloudinary';

export const runtime = 'nodejs';

export async function POST() {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!isCloudinaryConfigured()) {
    return NextResponse.json(
      {
        error:
          'File storage is not configured. Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      },
      { status: 503 },
    );
  }

  const folder = `pm/${ctx.orgId}`;
  const params = signUpload(folder);
  return NextResponse.json(params);
}

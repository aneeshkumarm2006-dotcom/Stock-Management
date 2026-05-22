// GET /api/pm/listings/:id/export-html
//
// BR-LA-2 — returns a small static HTML document a PM can copy/paste into
// other listing platforms. We build it inline rather than via a templating
// engine since the field set is tiny and the output is one-off.
import { NextResponse } from 'next/server';
import mongoose, { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { Listing } from '@/lib/db/models/pm/Listing';
import {
  getPmContext,
  unauthorizedResponse,
} from '@/lib/auth/getCurrentUser';
import { formatUsd } from '@/lib/pm/currency';

export const runtime = 'nodejs';

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface PropertyRow {
  propertyName: string;
  address?: {
    line1?: string;
    line2?: string;
    line3?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  await connectToDatabase();
  const doc = await Listing.findOne({
    _id: new Types.ObjectId(params.id),
    organizationId: new Types.ObjectId(ctx.orgId),
  }).lean();
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!doc.listed) {
    return NextResponse.json(
      { error: 'Unit must be Listed before export (BR-LA-2).' },
      { status: 400 },
    );
  }

  const conn = mongoose.connection;
  let prop: PropertyRow | null = null;
  if (conn?.db) {
    prop = (await conn.db
      .collection('pm_properties')
      .findOne(
        { _id: doc.propertyId, organizationId: doc.organizationId },
        { projection: { propertyName: 1, address: 1 } },
      )) as unknown as PropertyRow | null;
  }

  const addressLine = prop?.address
    ? [
        prop.address.line1,
        prop.address.line2,
        prop.address.line3,
        prop.address.city,
        prop.address.state,
        prop.address.zip,
      ]
        .filter(Boolean)
        .join(', ')
    : '';

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${escape(prop?.propertyName ?? 'Rental Listing')}</title>`,
    '<style>',
    'body{font-family:system-ui,sans-serif;max-width:680px;margin:2rem auto;padding:0 1rem;color:#1f2937;line-height:1.5}',
    'h1{margin-bottom:0.25rem}',
    '.meta{color:#6b7280;margin-bottom:1rem}',
    '.price{font-size:1.5rem;font-weight:600;color:#0f172a}',
    'ul{padding-left:1.25rem}',
    '</style>',
    '</head>',
    '<body>',
    `<h1>${escape(prop?.propertyName ?? 'Rental Listing')}</h1>`,
    addressLine ? `<div class="meta">${escape(addressLine)}</div>` : '',
    `<div class="price">${escape(formatUsd(doc.listingRent ?? 0))} / month</div>`,
    doc.availableDate
      ? `<div class="meta">Available: ${escape(new Date(doc.availableDate).toLocaleDateString())}</div>`
      : '',
    doc.listingDeposit
      ? `<div class="meta">Security deposit: ${escape(formatUsd(doc.listingDeposit))}</div>`
      : '',
    doc.unitDescription
      ? `<p>${escape(doc.unitDescription)}</p>`
      : '',
    doc.unitAmenities && doc.unitAmenities.length > 0
      ? `<h2>Amenities</h2><ul>${doc.unitAmenities
          .map((a) => `<li>${escape(a)}</li>`)
          .join('')}</ul>`
      : '',
    doc.leaseTermsBlurb
      ? `<h2>Lease terms</h2><p>${escape(doc.leaseTermsBlurb)}</p>`
      : '',
    doc.contactName || doc.contactEmail || doc.contactPhone
      ? `<h2>Contact</h2><p>${[
          escape(doc.contactName ?? ''),
          escape(doc.contactPhone ?? ''),
          escape(doc.contactEmail ?? ''),
        ]
          .filter(Boolean)
          .join(' · ')}</p>`
      : '',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');

  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

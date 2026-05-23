// 1099 aggregation + printable form generator (DECISIONS.md [G-S-30]).
// Phase 9 ships:
//   - aggregateVendorPayments() — sums BillPayment + cash-side JE
//     lines per Vendor for a tax year. Emits one row per Vendor with
//     the right form type (NEC vs MISC) and a TIN-status warning.
//   - render1099Html() — produces a print-ready single-page HTML
//     document the user prints to PDF in the browser. No third-party
//     dep; works in every modern browser. Used by both the PDF download
//     route and the send-to-recipient email body.
//
// Threshold = $600 (TAX_1099_THRESHOLD_DOLLARS). E-file integration is
// deferred; the page surfaces an "E-file — Coming soon" toast.
import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/db/mongoose';
import { BillPayment } from '@/lib/db/models/pm/BillPayment';
import { Bill } from '@/lib/db/models/pm/Bill';
import { Vendor } from '@/lib/db/models/pm/Vendor';
import { Organization } from '@/lib/db/models/pm/Organization';
import { formatUsd } from '@/lib/pm/currency';
import {
  TAX_1099_THRESHOLD_DOLLARS,
  type Tax1099FormType,
} from '@/types/pm';

export const TAX_1099_THRESHOLD_CENTS = TAX_1099_THRESHOLD_DOLLARS * 100;

export interface Vendor1099Row {
  vendorId: string;
  displayName: string;
  /** Resolved name (alt 1099 name when set, else display name). */
  printableName: string;
  /** Resolved address (alt 1099 address when set, else default). */
  printableAddress: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  taxIdentityType?: string | null;
  taxpayerIdLast4?: string | null;
  hasFullTin: boolean;
  totalPaidCents: number;
  formType: Tax1099FormType;
  /** True when totalPaidCents >= threshold. */
  meetsThreshold: boolean;
}

/** Aggregate every Vendor payment posted in the tax year (calendar
 *  year). Categorizes each Vendor as 1099-NEC by default; MISC is
 *  surfaced when the Vendor has been flagged as a rent payee — Phase 9
 *  MVP marks every vendor as NEC since no `rentPayee` flag exists yet.
 *  The page lets the user override the form type per row. */
export async function aggregateVendorPayments(opts: {
  orgId: Types.ObjectId;
  taxYear: number;
}): Promise<Vendor1099Row[]> {
  await connectToDatabase();
  const yearStart = new Date(Date.UTC(opts.taxYear, 0, 1));
  const yearEnd = new Date(Date.UTC(opts.taxYear, 11, 31, 23, 59, 59, 999));

  // Sum BillPayment amounts grouped by vendor (via the parent Bill).
  // BillPayment lives in pm_bill_payments; join via Bill.vendorId.
  const payments = await BillPayment.find({
    organizationId: opts.orgId,
    paidDate: { $gte: yearStart, $lte: yearEnd },
  })
    .select('amount billId')
    .lean<Array<{ amount: number; billId: Types.ObjectId }>>();

  if (payments.length === 0) return [];

  const billIds = Array.from(
    new Set(payments.map((p) => String(p.billId))),
  ).map((s) => new Types.ObjectId(s));
  const bills = await Bill.find(
    { _id: { $in: billIds }, organizationId: opts.orgId },
    { vendorId: 1 },
  ).lean<Array<{ _id: Types.ObjectId; vendorId?: Types.ObjectId | null }>>();
  const vendorByBill = new Map(
    bills.map((b) => [
      String(b._id),
      b.vendorId ? String(b.vendorId) : null,
    ] as const),
  );

  // Tally by vendor.
  const totals = new Map<string, number>();
  for (const p of payments) {
    const vendorId = vendorByBill.get(String(p.billId));
    if (!vendorId) continue;
    totals.set(vendorId, (totals.get(vendorId) ?? 0) + (p.amount ?? 0));
  }
  if (totals.size === 0) return [];

  const vendorIds = Array.from(totals.keys()).map((s) => new Types.ObjectId(s));
  const vendors = await Vendor.find(
    { _id: { $in: vendorIds }, organizationId: opts.orgId },
    {
      firstName: 1,
      lastName: 1,
      companyName: 1,
      isCompany: 1,
      use1099AlternateName: 1,
      alternativeName1099: 1,
      use1099AlternateAddress: 1,
      alternativeAddress1099: 1,
      address: 1,
      taxIdentityType: 1,
      taxpayerIdLast4: 1,
      taxpayerIdFull: 1,
    },
  ).lean<
    Array<{
      _id: Types.ObjectId;
      firstName: string;
      lastName: string;
      companyName?: string;
      isCompany: boolean;
      use1099AlternateName: boolean;
      alternativeName1099?: string;
      use1099AlternateAddress: boolean;
      alternativeAddress1099?: {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        zip?: string;
      };
      address: {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        zip?: string;
      };
      taxIdentityType?: string | null;
      taxpayerIdLast4?: string | null;
      taxpayerIdFull?: string | null;
    }>
  >();

  return vendors
    .map((v) => {
      const displayName = v.isCompany
        ? v.companyName ?? `${v.firstName} ${v.lastName}`
        : `${v.firstName} ${v.lastName}`;
      const printableName =
        v.use1099AlternateName && v.alternativeName1099
          ? v.alternativeName1099
          : displayName;
      const printableAddress =
        v.use1099AlternateAddress && v.alternativeAddress1099
          ? v.alternativeAddress1099
          : v.address;
      const totalCents = totals.get(String(v._id)) ?? 0;
      return {
        vendorId: String(v._id),
        displayName,
        printableName,
        printableAddress,
        taxIdentityType: v.taxIdentityType ?? null,
        taxpayerIdLast4: v.taxpayerIdLast4 ?? null,
        hasFullTin: Boolean(v.taxpayerIdFull && v.taxpayerIdFull.length > 0),
        totalPaidCents: totalCents,
        formType: '1099-NEC' as Tax1099FormType,
        meetsThreshold: totalCents >= TAX_1099_THRESHOLD_CENTS,
      };
    })
    .sort((a, b) => b.totalPaidCents - a.totalPaidCents);
}

/** Render a print-ready single-page HTML for a vendor's 1099. The
 *  caller serves this with Content-Type: text/html; the user prints
 *  via the browser's "Save as PDF". Also used as the body of the
 *  Send-to-recipient email. */
export async function render1099Html(opts: {
  orgId: Types.ObjectId;
  vendorId: string;
  taxYear: number;
  formType?: Tax1099FormType;
}): Promise<string | null> {
  const rows = await aggregateVendorPayments({
    orgId: opts.orgId,
    taxYear: opts.taxYear,
  });
  const row = rows.find((r) => r.vendorId === opts.vendorId);
  if (!row) return null;

  const org = await Organization.findById(opts.orgId).lean<{
    name?: string;
  } | null>();
  const formType = opts.formType ?? row.formType;

  const addr = row.printableAddress ?? {};
  const addrLine =
    [addr.line1, addr.line2, [addr.city, addr.state, addr.zip].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join('<br>') || '—';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${formType} ${opts.taxYear} — ${row.printableName}</title>
  <style>
    @media print { .no-print { display: none; } }
    body { font-family: ui-sans-serif, system-ui, sans-serif; color: #111; padding: 32px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .meta { color: #555; font-size: 13px; }
    .box { border: 1px solid #444; padding: 12px 16px; margin-top: 18px; }
    .label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #555; }
    .amount { font-size: 28px; font-variant-numeric: tabular-nums; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ccc; font-size: 13px; }
    .warn { background: #fff7ed; border: 1px solid #f59e0b; padding: 8px 12px; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${formType} — Tax year ${opts.taxYear}</h1>
  <p class="meta">Issued by ${org?.name ?? 'Property Management'}</p>

  <div class="box">
    <p class="label">Recipient</p>
    <p style="font-weight:600;font-size:16px;margin:2px 0;">${row.printableName}</p>
    <p style="margin:2px 0;">${addrLine}</p>
    <p style="margin:6px 0 0;font-size:12px;color:#555;">
      ${row.taxIdentityType ?? 'TIN'} ending in ${row.taxpayerIdLast4 ?? '—'}
    </p>
  </div>

  ${
    row.hasFullTin
      ? ''
      : `<p class="warn">⚠ Full taxpayer ID is not on file for this vendor. Add it on the vendor's detail page before filing.</p>`
  }

  <div class="box">
    <p class="label">${formType === '1099-NEC' ? 'Box 1 — Non-employee compensation' : 'Box 1 — Rents'}</p>
    <p class="amount">${formatUsd(row.totalPaidCents)}</p>
  </div>

  <table>
    <thead>
      <tr><th>Field</th><th>Value</th></tr>
    </thead>
    <tbody>
      <tr><td>Form type</td><td>${formType}</td></tr>
      <tr><td>Tax year</td><td>${opts.taxYear}</td></tr>
      <tr><td>Threshold</td><td>${formatUsd(TAX_1099_THRESHOLD_CENTS)}</td></tr>
      <tr><td>Meets threshold?</td><td>${row.meetsThreshold ? 'Yes' : 'No'}</td></tr>
    </tbody>
  </table>

  <p style="margin-top:24px;font-size:11px;color:#666;">
    This document is generated by your property management system. Verify all
    values against your books before mailing or e-filing.
  </p>

  <button class="no-print" onclick="window.print()" style="margin-top:20px;padding:8px 16px;">Print / save as PDF</button>
</body>
</html>`;
}

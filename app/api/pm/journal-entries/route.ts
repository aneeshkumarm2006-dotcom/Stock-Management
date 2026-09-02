// JournalEntry CRUD (PDR §3.19, BR-AC-1, BR-AC-3, BR-AC-14).
// GET supports filter chips on the GL page: ?accountId, ?propertyId, ?from,
// ?to, ?status, plus simple ?limit (default 100, max 500). Cursors deferred —
// MVP returns most-recent-first windowed by date.
//
// POST runs Zod → locked-period gate (per-property scoped) → save. The model
// pre('validate') hook performs the integer-cents balance check again so a
// malformed admin override still fails closed.
import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/mongoose";
import { JournalEntry } from "@/lib/db/models/pm/JournalEntry";
import { getPmContext, unauthorizedResponse } from "@/lib/auth/getCurrentUser";
import { journalEntryCreateSchema } from "@/lib/validation/pm/journalEntry";
import { logActivity } from "@/lib/pm/activity";
import { toCents } from "@/lib/pm/currency";
import { assertWriteAllowed, LockedPeriodError } from "@/lib/pm/lockedPeriod";
import { dateWindowClause, parseDateWindow } from "@/lib/pm/dateWindow";
import { serializeJournalEntry } from "./serialize";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const propertyId = searchParams.get("propertyId");
  // `company:<id>` drill-through from the Financials matrix. The literal
  // 'none' asks for the LEGACY bucket — Company-scoped lines with no company —
  // which is a different question from "any company" and must not silently
  // widen into it.
  const companyId = searchParams.get("companyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const status = searchParams.get("status");
  const includeVoided = searchParams.get("includeVoided") === "1";
  const limitRaw = Number(searchParams.get("limit") ?? "100");
  const limit = Math.max(
    1,
    Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100),
  );

  await connectToDatabase();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(ctx.orgId),
  };
  if (status) filter.status = status;
  else if (!includeVoided) filter.status = { $ne: "Voided" };

  // A void is a PAIR: the Voided original plus its Posted mirror-image
  // reversal. Hiding only the original left the reversal on screen as a
  // free-standing entry that looks like a real transaction — and, because it
  // carries the opposite sign, reads as a mystery deduction. "Include voided
  // entries" governs the pair, so hide the reversal alongside its original
  // and bring both back together. An explicit ?status= filter is an audit
  // query, so it still returns exactly what was asked for.
  if (!status && !includeVoided) filter.reversesJournalEntryId = null;

  // ONE $elemMatch, not sibling `lines.x` keys.
  //
  // Mongo does not require sibling dotted paths to match the SAME array
  // element, so `{'lines.accountId': A, 'lines.scopeType':'Property',
  // 'lines.scopeId': P}` also matched an entry holding account A on one line
  // and property P on a different one. A Financials cell sums lines where the
  // account AND the scope hold together, so drilling into it returned entries
  // the cell never counted. An allocated bill — Company-scoped AP credit,
  // per-property debits — hits this on every drill-through.
  const lineMatch: Record<string, unknown> = {};
  if (accountId && Types.ObjectId.isValid(accountId)) {
    lineMatch.accountId = new Types.ObjectId(accountId);
  }
  if (propertyId && Types.ObjectId.isValid(propertyId)) {
    lineMatch.scopeType = "Property";
    lineMatch.scopeId = new Types.ObjectId(propertyId);
  } else if (companyId === "none") {
    lineMatch.scopeType = "Company";
    lineMatch.scopeId = null;
  } else if (companyId && Types.ObjectId.isValid(companyId)) {
    lineMatch.scopeType = "Company";
    lineMatch.scopeId = new Types.ObjectId(companyId);
  }
  if (Object.keys(lineMatch).length > 0) {
    filter.lines = { $elemMatch: lineMatch };
  }
  // Half-open UTC interval — `to` is inclusive of its whole calendar day. The
  // old `$lte: new Date(to)` was midnight, so an entry dated on the closing day
  // with a time component vanished from the drill-through while still counting
  // in the cell that linked here. See lib/pm/dateWindow.ts.
  const dateClause = dateWindowClause(parseDateWindow(from, to));
  if (dateClause) filter.date = dateClause;

  const rows = await JournalEntry.find(filter)
    .sort({ date: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return NextResponse.json(
    rows.map((r) => serializeJournalEntry(r as Record<string, unknown>)),
  );
}

export async function POST(request: Request) {
  const ctx = await getPmContext();
  if (!ctx) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = journalEntryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const txnDate = new Date(parsed.data.date);
  if (Number.isNaN(txnDate.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  // BR-AC-3 — block writes inside locked periods, per affected Property scope.
  try {
    // Check entry-level scope first.
    if (parsed.data.scopeType === "Property" && parsed.data.scopeId) {
      await assertWriteAllowed({
        orgId: ctx.orgId,
        txnDate,
        scopePropertyId: parsed.data.scopeId,
        ctx,
      });
    } else {
      await assertWriteAllowed({ orgId: ctx.orgId, txnDate, ctx });
    }
    // BR-AC-14 — each Property-scoped line might be locked independently.
    for (const line of parsed.data.lines) {
      if (line.scopeType === "Property" && line.scopeId) {
        await assertWriteAllowed({
          orgId: ctx.orgId,
          txnDate,
          scopePropertyId: line.scopeId,
          ctx,
        });
      }
    }
  } catch (err) {
    if (err instanceof LockedPeriodError) {
      return NextResponse.json(
        { error: err.policyMessage, policyId: err.policyId },
        { status: 423 },
      );
    }
    throw err;
  }

  await connectToDatabase();

  try {
    const doc = await JournalEntry.create({
      organizationId: new Types.ObjectId(ctx.orgId),
      date: txnDate,
      scopeType: parsed.data.scopeType,
      scopeId: parsed.data.scopeId
        ? new Types.ObjectId(parsed.data.scopeId)
        : null,
      memo: parsed.data.memo,
      attachmentFileId: parsed.data.attachmentFileId
        ? new Types.ObjectId(parsed.data.attachmentFileId)
        : null,
      lines: parsed.data.lines.map((l) => ({
        accountId: new Types.ObjectId(l.accountId),
        scopeType: l.scopeType,
        scopeId: l.scopeId ? new Types.ObjectId(l.scopeId) : null,
        unitId: l.unitId ? new Types.ObjectId(l.unitId) : null,
        name: l.name,
        description: l.description,
        debit: toCents(l.debit),
        credit: toCents(l.credit),
      })),
      status: parsed.data.status,
      createdByUserId: new Types.ObjectId(ctx.userId),
    });

    await logActivity({
      orgId: ctx.orgId,
      parentType: "JournalEntry",
      parentId: doc._id,
      eventType:
        doc.status === "Posted"
          ? "JournalEntry posted"
          : "JournalEntry created (Draft)",
      actorUserId: ctx.userId,
      payload: {
        totalDebits: doc.totalDebits,
        totalCredits: doc.totalCredits,
        lineCount: doc.lines.length,
      },
    });

    return NextResponse.json(
      serializeJournalEntry(
        doc.toObject() as unknown as Record<string, unknown>,
      ),
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to save journal entry";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

interface SerializableLine {
  accountId: string;
  scopeType: 'Property' | 'Company';
  scopeId: string | null;
  unitId: string | null;
  name: string;
  description: string;
  debit: number;
  credit: number;
}

interface SerializableJE {
  id: string;
  date: string;
  scopeType: 'Property' | 'Company';
  scopeId: string | null;
  memo: string;
  attachmentFileId: string | null;
  lines: SerializableLine[];
  totalDebits: number;
  totalCredits: number;
  status: 'Posted' | 'Draft' | 'Voided';
  postedAt: string | null;
  voidedAt: string | null;
  voidedByUserId: string | null;
  reversesJournalEntryId: string | null;
  reversedByJournalEntryId: string | null;
  createdByUserId: string;
  createdAt: string;
}

export function serializeJournalEntry(d: Record<string, unknown>): SerializableJE {
  const lines = (d.lines as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: String(d._id),
    date: d.date instanceof Date ? d.date.toISOString() : String(d.date),
    scopeType: d.scopeType as 'Property' | 'Company',
    scopeId: d.scopeId ? String(d.scopeId) : null,
    memo: (d.memo as string) ?? '',
    attachmentFileId: d.attachmentFileId ? String(d.attachmentFileId) : null,
    lines: lines.map((l) => ({
      accountId: String(l.accountId),
      scopeType: l.scopeType as 'Property' | 'Company',
      scopeId: l.scopeId ? String(l.scopeId) : null,
      unitId: l.unitId ? String(l.unitId) : null,
      name: (l.name as string) ?? '',
      description: (l.description as string) ?? '',
      debit: Number(l.debit ?? 0),
      credit: Number(l.credit ?? 0),
    })),
    totalDebits: Number(d.totalDebits ?? 0),
    totalCredits: Number(d.totalCredits ?? 0),
    status: d.status as 'Posted' | 'Draft' | 'Voided',
    postedAt:
      d.postedAt instanceof Date ? d.postedAt.toISOString() : (d.postedAt as string) ?? null,
    voidedAt:
      d.voidedAt instanceof Date ? d.voidedAt.toISOString() : (d.voidedAt as string) ?? null,
    voidedByUserId: d.voidedByUserId ? String(d.voidedByUserId) : null,
    reversesJournalEntryId: d.reversesJournalEntryId
      ? String(d.reversesJournalEntryId)
      : null,
    reversedByJournalEntryId: d.reversedByJournalEntryId
      ? String(d.reversedByJournalEntryId)
      : null,
    createdByUserId: String(d.createdByUserId),
    createdAt:
      d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
  };
}

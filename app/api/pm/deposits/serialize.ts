export function serializeDeposit(d: Record<string, unknown>) {
  const items = (d.depositItems as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: String(d._id),
    bankAccountId: String(d.bankAccountId),
    date: d.date instanceof Date ? d.date.toISOString() : String(d.date),
    memo: (d.memo as string) ?? '',
    totalAmount: Number(d.totalAmount ?? 0),
    depositItems: items.map((i) => ({
      scopeType: i.scopeType as 'Property' | 'Company',
      scopeId: i.scopeId ? String(i.scopeId) : null,
      unitId: i.unitId ? String(i.unitId) : null,
      accountId: String(i.accountId),
      description: (i.description as string) ?? '',
      refNo: (i.refNo as string) ?? '',
      amount: Number(i.amount ?? 0),
    })),
    attachmentFileId: d.attachmentFileId ? String(d.attachmentFileId) : null,
    journalEntryId: d.journalEntryId ? String(d.journalEntryId) : null,
    status: d.status as 'Posted' | 'Voided',
    createdAt:
      d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
  };
}

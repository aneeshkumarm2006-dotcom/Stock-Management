export function serializeCompanyAccount(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    name: (d.name as string) ?? '',
    defaultCashAccountId: d.defaultCashAccountId
      ? String(d.defaultCashAccountId)
      : null,
    active: Boolean(d.active),
    createdAt:
      d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
  };
}

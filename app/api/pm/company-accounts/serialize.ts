export function serializeCompanyAccount(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    name: (d.name as string) ?? '',
    defaultCashAccountId: d.defaultCashAccountId
      ? String(d.defaultCashAccountId)
      : null,
    // null = inherit Organization.defaultCurrency (resolveCompanyCurrency).
    currency: (d.currency as string | undefined) ?? null,
    active: Boolean(d.active),
    createdAt:
      d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
  };
}

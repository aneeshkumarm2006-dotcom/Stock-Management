export function serializeLockedPeriod(d: Record<string, unknown>) {
  return {
    id: String(d._id),
    scope: d.scope as 'Global' | 'Per-property',
    propertyId: d.propertyId ? String(d.propertyId) : null,
    fromDate: d.fromDate instanceof Date ? d.fromDate.toISOString() : (d.fromDate as string) ?? null,
    toDate: d.toDate instanceof Date ? d.toDate.toISOString() : (d.toDate as string) ?? null,
    message: (d.message as string) ?? '',
    active: Boolean(d.active),
    createdAt:
      d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
  };
}

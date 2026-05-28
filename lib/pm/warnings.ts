// Non-blocking yellow-warning system. Every creation modal in the PM app used
// to hard-block on "required" form fields with an error toast. Per the user's
// directive, we now allow creation to proceed and stamp the entity with a
// `warnings: PmWarning[]` array. The list/detail UI surfaces each warning as
// an amber badge with full message text plus a × Ignore button. Dismissed
// warnings set `dismissedAt` so they stay hidden across refreshes.
//
// Type/format checks (max length, enum membership, numeric bounds, FK shape)
// stay as hard validators in Zod + Mongoose. Only presence and conditional
// business-rule checks (sum=100, "if X then Y must be set") become warnings.
//
// Adding a new warning code:
//   1. Add it to WARNING_CODES under the right entity
//   2. Add its message to WARNING_MESSAGES (interpolate via ctx)
//   3. Add its condition branch to computeWarnings()
//   4. UI picks it up automatically via WarningBadge

export interface PmWarning {
  code: string;
  message: string;
  dismissedAt?: Date | null;
}

export type WarningableType =
  | 'Property'
  | 'WorkOrder'
  | 'DraftLease'
  | 'CalendarEvent'
  | 'Budget'
  | 'OwnerContributionRequest'
  | 'BillPayment'
  | 'LockedPeriodPolicy'
  | 'ApprovalRule'
  | 'PmFile'
  | 'RecurringTransaction';

export const WARNINGABLE_TYPES: WarningableType[] = [
  'Property',
  'WorkOrder',
  'DraftLease',
  'CalendarEvent',
  'Budget',
  'OwnerContributionRequest',
  'BillPayment',
  'LockedPeriodPolicy',
  'ApprovalRule',
  'PmFile',
  'RecurringTransaction',
];

export const WARNING_CODES = {
  Property: {
    NO_OPERATING_ACCOUNT: 'NO_OPERATING_ACCOUNT',
    MISSING_PROPERTY_NAME: 'MISSING_PROPERTY_NAME',
    MISSING_PROPERTY_SUBTYPE: 'MISSING_PROPERTY_SUBTYPE',
    MISSING_ADDRESS_LINE1: 'MISSING_ADDRESS_LINE1',
    MISSING_CITY: 'MISSING_CITY',
    MISSING_STATE: 'MISSING_STATE',
    MISSING_ZIP: 'MISSING_ZIP',
    OWNERSHIP_SUM_NOT_100: 'OWNERSHIP_SUM_NOT_100',
    OWNER_ROW_UNASSIGNED: 'OWNER_ROW_UNASSIGNED',
    SUBTYPE_CLASS_MISMATCH: 'SUBTYPE_CLASS_MISMATCH',
    MANAGEMENT_FEE_BOTH_OR_NEITHER: 'MANAGEMENT_FEE_BOTH_OR_NEITHER',
  },
  WorkOrder: {
    NO_VENDOR_ASSIGNED: 'NO_VENDOR_ASSIGNED',
    NO_ASSIGNEE: 'NO_ASSIGNEE',
    CHARGE_TARGET_MISSING: 'CHARGE_TARGET_MISSING',
    MISSING_SUBJECT: 'MISSING_SUBJECT',
  },
  DraftLease: {
    MISSING_PROPERTY_OR_UNIT: 'MISSING_PROPERTY_OR_UNIT',
    MISSING_RENT_ACCOUNT: 'MISSING_RENT_ACCOUNT',
  },
  CalendarEvent: {
    CALENDAR_MISSING_PROPERTY: 'CALENDAR_MISSING_PROPERTY',
    CALENDAR_MISSING_NAME: 'CALENDAR_MISSING_NAME',
    CALENDAR_END_BEFORE_START: 'CALENDAR_END_BEFORE_START',
  },
  Budget: {
    BUDGET_MISSING_SCOPE: 'BUDGET_MISSING_SCOPE',
    BUDGET_MISSING_NAME: 'BUDGET_MISSING_NAME',
    BUDGET_MISSING_COPY_SOURCE: 'BUDGET_MISSING_COPY_SOURCE',
  },
  OwnerContributionRequest: {
    MISSING_BANK_ACCOUNT: 'MISSING_BANK_ACCOUNT',
  },
  BillPayment: {
    MISSING_BANK_ACCOUNT: 'MISSING_BANK_ACCOUNT',
    MISSING_CHECK_NUMBER: 'MISSING_CHECK_NUMBER',
  },
  LockedPeriodPolicy: {
    LOCK_MISSING_PROPERTY: 'LOCK_MISSING_PROPERTY',
  },
  ApprovalRule: {
    RULE_MISSING_APPROVERS: 'RULE_MISSING_APPROVERS',
    RULE_MISSING_SCOPE: 'RULE_MISSING_SCOPE',
  },
  PmFile: {
    FILE_MISSING_CATEGORY: 'FILE_MISSING_CATEGORY',
    FILE_MISSING_LOCATION: 'FILE_MISSING_LOCATION',
  },
  RecurringTransaction: {
    RECURRING_MISSING_PAYEE: 'RECURRING_MISSING_PAYEE',
  },
} as const;

type MessageBuilder = (ctx?: Record<string, unknown>) => string;

export const WARNING_MESSAGES: Record<string, MessageBuilder> = {
  // Property
  NO_OPERATING_ACCOUNT: () =>
    'No operating account configured — incoming rent and outgoing payments cannot post until you set one in Property Settings → Bank Accounts.',
  MISSING_PROPERTY_NAME: () =>
    'Property name is blank — the property will show as "Untitled" in lists. Add a name on the detail page.',
  MISSING_PROPERTY_SUBTYPE: () =>
    'Sub-type is blank — reports cannot group this property by category until you pick a Residential/Commercial sub-type.',
  MISSING_ADDRESS_LINE1: () =>
    'Street address is blank — this property will not appear in mailing-address lookups or 1099 reports until line 1 is filled in.',
  MISSING_CITY: () =>
    'City is blank — required for tax-jurisdiction lookups and tenant correspondence. Edit on the property detail page.',
  MISSING_STATE: () =>
    'State is blank — required for state-specific lease compliance and rent-tax rules. Pick a state on the property detail page.',
  MISSING_ZIP: () =>
    'ZIP code is blank — required for mailings, property-tax reports, and resident-center geo features.',
  OWNERSHIP_SUM_NOT_100: (ctx) =>
    `Owner shares add up to ${ctx?.sum ?? '?'}% (must be 100%) — distributions and 1099 splits will be skipped until shares total 100%.`,
  OWNER_ROW_UNASSIGNED: () =>
    'One or more owner rows has no owner selected — those rows are ignored when computing distributions. Pick an owner on the detail page.',
  SUBTYPE_CLASS_MISMATCH: (ctx) =>
    `Sub-type "${ctx?.sub ?? '?'}" is not in the ${ctx?.cls ?? '?'} list — reports may misclassify this property. Pick a matching sub-type on the detail page.`,
  MANAGEMENT_FEE_BOTH_OR_NEITHER: () =>
    'Active management-fee agreement needs exactly one of fee percent or flat fee. Fix on Property Settings → Fees.',
  // WorkOrder
  NO_VENDOR_ASSIGNED: () =>
    'No vendor selected — work order cannot be dispatched and the vendor portal will not see it. Assign one from the work order detail page.',
  NO_ASSIGNEE: () =>
    "No staff assignee — this work order will not appear on anyone's My Tasks list until you assign it.",
  CHARGE_TARGET_MISSING: () =>
    '"Charge work to" type is set but no target is picked — costs will not post to a bill or tenant ledger.',
  MISSING_SUBJECT: () =>
    'Subject is blank — this work order will show as "Untitled" in lists. Edit to add a clear subject.',
  // DraftLease
  MISSING_PROPERTY_OR_UNIT: () =>
    'Property and unit not selected — this draft lease cannot be promoted to an active lease and is not counted in occupancy.',
  MISSING_RENT_ACCOUNT: () =>
    'No rental income account picked — rent charges will not post to the GL when this lease is executed.',
  // CalendarEvent
  CALENDAR_MISSING_PROPERTY: () =>
    'No property selected — this event will not appear on any property calendar (BR-CC-6).',
  CALENDAR_MISSING_NAME: () =>
    'Event name is blank — calendar views will show "Untitled". Edit on the event detail page.',
  CALENDAR_END_BEFORE_START: () =>
    'End time is before start time — calendar views will treat this as a zero-length event (BR-CC-11).',
  // Budget
  BUDGET_MISSING_SCOPE: () =>
    'No scope (property or company) selected — this budget is unscoped and will not appear in reports.',
  BUDGET_MISSING_NAME: () =>
    'Budget name is blank — reports list will show "Untitled". Edit to add a name.',
  BUDGET_MISSING_COPY_SOURCE: () =>
    '"Copy existing budget" was chosen but no source budget was picked — the budget was created with zero amounts.',
  // OwnerContributionRequest / BillPayment shared
  MISSING_BANK_ACCOUNT: () =>
    'No bank account selected — payment recorded as pending; cash side will not post to the GL until you assign an account on the detail page.',
  MISSING_CHECK_NUMBER: () =>
    'Method is Check but no check number was entered — required for bank reconciliation. Edit the payment to add one.',
  // LockedPeriodPolicy
  LOCK_MISSING_PROPERTY: () =>
    'Per-property scope selected but no property picked — this lock is treated as Company-wide until a property is chosen.',
  // ApprovalRule
  RULE_MISSING_APPROVERS: () =>
    'No approvers selected — this rule will auto-approve every match because no one needs to sign off.',
  RULE_MISSING_SCOPE: () =>
    'Property scope selected but no property picked — rule will not match anything until you set the property.',
  // PmFile
  FILE_MISSING_CATEGORY: () =>
    'No category assigned (BR-FI-2) — this file will not show under any category filter. Edit the file to set one.',
  FILE_MISSING_LOCATION: () =>
    'Location type is set but no location target is picked — the file is unanchored and will not appear on any entity\'s Files tab.',
  // RecurringTransaction
  RECURRING_MISSING_PAYEE: () =>
    'Type is Check/Bill but no payee is selected — when this recurrence fires, the generated transaction will fail to post (BR-AC-9). Edit the recurrence to add a payee.',
};

export function getWarningMessage(
  code: string,
  ctx?: Record<string, unknown>,
): string {
  const builder = WARNING_MESSAGES[code];
  if (!builder) return code;
  return builder(ctx);
}

// Residential / Commercial subtype sets used by SUBTYPE_CLASS_MISMATCH.
const RES_SUBTYPES = new Set(['Single-Family', 'Multi-Family', 'Condo-Townhome']);
const COM_SUBTYPES = new Set(['Industrial', 'Office', 'Retail']);

function strBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

function fkBlank(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v);
  return s === '' || s === 'null' || s === 'undefined';
}

function mk(code: string, ctx?: Record<string, unknown>): PmWarning {
  return { code, message: getWarningMessage(code, ctx), dismissedAt: null };
}

// Pure: reads only `entity`'s own fields. No DB calls. Returns the FULL set of
// codes that currently apply; the caller merges with previously-dismissed
// codes via mergeWarnings().
//
// Accepts `unknown` so callers can pass a Mongoose lean object or doc.toObject()
// without per-call casting. Internally we narrow to a record.
export function computeWarnings(
  rawEntity: unknown,
  type: WarningableType,
): PmWarning[] {
  const entity = (rawEntity ?? {}) as Record<string, unknown>;
  const out: PmWarning[] = [];
  switch (type) {
    case 'Property': {
      if (strBlank(entity.propertyName)) out.push(mk('MISSING_PROPERTY_NAME'));
      if (strBlank(entity.propertySubType)) out.push(mk('MISSING_PROPERTY_SUBTYPE'));
      const addr = (entity.address ?? {}) as Record<string, unknown>;
      if (strBlank(addr.line1)) out.push(mk('MISSING_ADDRESS_LINE1'));
      if (strBlank(addr.city)) out.push(mk('MISSING_CITY'));
      if (strBlank(addr.state)) out.push(mk('MISSING_STATE'));
      if (strBlank(addr.zip)) out.push(mk('MISSING_ZIP'));
      if (fkBlank(entity.operatingAccountId)) out.push(mk('NO_OPERATING_ACCOUNT'));
      const owners = (entity.rentalOwners ?? []) as Array<Record<string, unknown>>;
      if (owners.length > 0) {
        const sum = owners.reduce(
          (a, r) => a + (Number.isFinite(r.ownershipPct) ? (r.ownershipPct as number) : 0),
          0,
        );
        if (Math.abs(sum - 100) > 0.01) {
          out.push(mk('OWNERSHIP_SUM_NOT_100', { sum }));
        }
        if (owners.some((o) => fkBlank(o.rentalOwnerId))) {
          out.push(mk('OWNER_ROW_UNASSIGNED'));
        }
      }
      const cls = entity.propertyClass as string | undefined;
      const sub = entity.propertySubType as string | undefined;
      if (cls && sub) {
        if (cls === 'Residential' && !RES_SUBTYPES.has(sub)) {
          out.push(mk('SUBTYPE_CLASS_MISMATCH', { sub, cls }));
        } else if (cls === 'Commercial' && !COM_SUBTYPES.has(sub)) {
          out.push(mk('SUBTYPE_CLASS_MISMATCH', { sub, cls }));
        }
      }
      const mfa = entity.managementFeeAgreement as Record<string, unknown> | null | undefined;
      if (mfa && mfa.active) {
        const hasPct =
          mfa.feePercent != null && Number(mfa.feePercent) > 0;
        const hasFlat =
          mfa.feeFlatCents != null && Number(mfa.feeFlatCents) > 0;
        if (hasPct === hasFlat) out.push(mk('MANAGEMENT_FEE_BOTH_OR_NEITHER'));
      }
      break;
    }
    case 'WorkOrder': {
      if (strBlank(entity.subject)) out.push(mk('MISSING_SUBJECT'));
      if (fkBlank(entity.vendorId)) out.push(mk('NO_VENDOR_ASSIGNED'));
      if (fkBlank(entity.assignedToUserId)) out.push(mk('NO_ASSIGNEE'));
      const charge = entity.chargeWorkTo as Record<string, unknown> | null | undefined;
      if (charge && !strBlank(charge.type) && fkBlank(charge.id)) {
        out.push(mk('CHARGE_TARGET_MISSING'));
      }
      break;
    }
    case 'DraftLease': {
      if (fkBlank(entity.propertyId) || fkBlank(entity.unitId)) {
        out.push(mk('MISSING_PROPERTY_OR_UNIT'));
      }
      const primary = entity.primaryRent as Record<string, unknown> | null | undefined;
      if (!primary || fkBlank(primary.accountId)) {
        out.push(mk('MISSING_RENT_ACCOUNT'));
      }
      break;
    }
    case 'CalendarEvent': {
      if (fkBlank(entity.propertyId)) out.push(mk('CALENDAR_MISSING_PROPERTY'));
      if (strBlank(entity.eventName)) out.push(mk('CALENDAR_MISSING_NAME'));
      const start = entity.startDate;
      const end = entity.endDate;
      if (start && end) {
        const s = start instanceof Date ? start.getTime() : Date.parse(String(start));
        const e = end instanceof Date ? end.getTime() : Date.parse(String(end));
        if (Number.isFinite(s) && Number.isFinite(e) && e < s) {
          out.push(mk('CALENDAR_END_BEFORE_START'));
        }
      }
      break;
    }
    case 'Budget': {
      if (fkBlank(entity.scopeId)) out.push(mk('BUDGET_MISSING_SCOPE'));
      if (strBlank(entity.name)) out.push(mk('BUDGET_MISSING_NAME'));
      if (
        entity.defaultAmounts === 'Copy existing budget' &&
        fkBlank(entity.copySourceBudgetId)
      ) {
        out.push(mk('BUDGET_MISSING_COPY_SOURCE'));
      }
      break;
    }
    case 'OwnerContributionRequest': {
      // MISSING_BANK_ACCOUNT is stamped imperatively by the record-payment
      // route when a payment is recorded without picking a bank account —
      // the warning is per-action, not derivable from the entity's own
      // fields. No auto-compute here.
      break;
    }
    case 'BillPayment': {
      if (fkBlank(entity.bankAccountId)) out.push(mk('MISSING_BANK_ACCOUNT'));
      // Accept both `paymentMethod` (server) and `method` (some client forms).
      const method =
        (entity.paymentMethod as string | undefined) ??
        (entity.method as string | undefined);
      if (method === 'Check' && strBlank(entity.checkNumber)) {
        out.push(mk('MISSING_CHECK_NUMBER'));
      }
      break;
    }
    case 'LockedPeriodPolicy': {
      if (entity.scope === 'Per-property' && fkBlank(entity.propertyId)) {
        out.push(mk('LOCK_MISSING_PROPERTY'));
      }
      break;
    }
    case 'ApprovalRule': {
      const approvers = (entity.approverUserIds ?? []) as unknown[];
      if (!Array.isArray(approvers) || approvers.length === 0) {
        out.push(mk('RULE_MISSING_APPROVERS'));
      }
      if (entity.scopeType === 'Property' && fkBlank(entity.scopeId)) {
        out.push(mk('RULE_MISSING_SCOPE'));
      }
      break;
    }
    case 'PmFile': {
      if (fkBlank(entity.categoryId)) out.push(mk('FILE_MISSING_CATEGORY'));
      const locType = entity.locationType as string | undefined;
      if (locType && locType !== 'Account' && strBlank(entity.locationId)) {
        out.push(mk('FILE_MISSING_LOCATION'));
      }
      break;
    }
    case 'RecurringTransaction': {
      if (entity.type !== 'Journal entry') {
        const payee = entity.payee as Record<string, unknown> | null | undefined;
        if (!payee || fkBlank(payee.id)) out.push(mk('RECURRING_MISSING_PAYEE'));
      }
      break;
    }
  }
  return out;
}

// Merge previously-stamped warnings with a fresh compute. Codes that no
// longer apply are dropped (so fixing a missing field clears the badge);
// codes that still apply are preserved verbatim so `dismissedAt` is kept
// when the user has already clicked Ignore.
export function mergeWarnings(
  existing: PmWarning[],
  computed: PmWarning[],
): PmWarning[] {
  const existingByCode = new Map(existing.map((w) => [w.code, w]));
  return computed.map((fresh) => {
    const prior = existingByCode.get(fresh.code);
    if (prior) {
      return {
        code: fresh.code,
        message: fresh.message, // refresh in case interpolation changed
        dismissedAt: prior.dismissedAt ?? null,
      };
    }
    return fresh;
  });
}

// Returns true when the entity has any undismissed warning whose code is in
// the caller-supplied "critical" set. Downstream jobs (1099 generation, GL
// posters, recurrence engines) should call this to defensively skip docs
// that carry blocking data-integrity issues.
export function hasBlockingWarnings(
  warnings: PmWarning[] | undefined,
  criticalCodes: string[],
): boolean {
  if (!warnings || warnings.length === 0) return false;
  const set = new Set(criticalCodes);
  return warnings.some((w) => !w.dismissedAt && set.has(w.code));
}

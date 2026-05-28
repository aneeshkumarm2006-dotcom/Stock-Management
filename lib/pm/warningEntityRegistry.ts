// Maps WarningableType → Mongoose model so the generic dismiss endpoint and
// any other generic warning-aware code can look up the correct collection
// without 11 if/else branches. Adding a new warningable entity is one entry.
import type { Model } from 'mongoose';
import { Property } from '@/lib/db/models/pm/Property';
import { WorkOrder } from '@/lib/db/models/pm/WorkOrder';
import { DraftLease } from '@/lib/db/models/pm/DraftLease';
import { CalendarEvent } from '@/lib/db/models/pm/CalendarEvent';
import { Budget } from '@/lib/db/models/pm/Budget';
import { OwnerContributionRequest } from '@/lib/db/models/pm/OwnerContributionRequest';
import { BillPayment } from '@/lib/db/models/pm/BillPayment';
import { LockedPeriodPolicy } from '@/lib/db/models/pm/LockedPeriodPolicy';
import { ApprovalRule } from '@/lib/db/models/pm/ApprovalRule';
import { PmFile } from '@/lib/db/models/pm/PmFile';
import { RecurringTransaction } from '@/lib/db/models/pm/RecurringTransaction';
import type { WarningableType } from '@/lib/pm/warnings';

export const WARNING_ENTITY_MODELS: Record<WarningableType, Model<unknown>> = {
  Property: Property as unknown as Model<unknown>,
  WorkOrder: WorkOrder as unknown as Model<unknown>,
  DraftLease: DraftLease as unknown as Model<unknown>,
  CalendarEvent: CalendarEvent as unknown as Model<unknown>,
  Budget: Budget as unknown as Model<unknown>,
  OwnerContributionRequest: OwnerContributionRequest as unknown as Model<unknown>,
  BillPayment: BillPayment as unknown as Model<unknown>,
  LockedPeriodPolicy: LockedPeriodPolicy as unknown as Model<unknown>,
  ApprovalRule: ApprovalRule as unknown as Model<unknown>,
  PmFile: PmFile as unknown as Model<unknown>,
  RecurringTransaction: RecurringTransaction as unknown as Model<unknown>,
};

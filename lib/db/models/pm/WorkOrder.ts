// WorkOrder + partsAndLabor (PDR_MASTER §3.10 + §3.10a).
//
// Every WO has a parent Task (BR-MV-5). Both staff (`assignedToUserId`) AND
// vendor (`vendorId`) are required (BR-MV-6). The partsAndLabor sub-grid
// (§3.10a) drives `billTotal` (derived) and ultimately the JournalEntry
// debit lines when a Bill is recorded (BR-MV-8).
//
// `billStatus` is independent of any Bill.status (BR-MV-9) so the WO can
// register "Open" while its underlying Bill is still Draft, or "Partially
// paid" / "Paid" once BillPayments roll up.
//
// `chargeWorkTo` is a polymorphic single-target reference (BR-MV-10) —
// resolution order ([G-B-30]) is "UI enforces single pick", which is enforced
// here by the discriminated union on the embedded sub-doc.
import { Schema, model, models, Types, type Model } from 'mongoose';
import type {
  ChargeTargetType,
  EntryDetails,
  WorkOrderBillStatus,
  WorkOrderStatus,
  WorkPriority,
} from '@/types/pm';

export const WORK_ORDER_STATUSES_DB: WorkOrderStatus[] = [
  'New',
  'In progress',
  'On hold',
  'Completed',
  'Cancelled',
];

export const WORK_ORDER_TERMINAL_STATUSES_DB: WorkOrderStatus[] = [
  'Completed',
  'Cancelled',
];

export const WORK_PRIORITIES_DB: WorkPriority[] = [
  'Low',
  'Normal',
  'High',
  'Urgent',
];

export const ENTRY_DETAILS_DB: EntryDetails[] = [
  'Tenant will be home',
  'Permission to enter',
  'Call first',
  'Do not enter',
];

export const WORK_ORDER_BILL_STATUSES_DB: WorkOrderBillStatus[] = [
  'No bills added',
  'Open',
  'Partially paid',
  'Paid',
  'Voided',
];

export const CHARGE_TARGET_TYPES_DB: ChargeTargetType[] = [
  'Property',
  'Lease',
  'RentalOwner',
];

export interface IPartsAndLabor {
  qty: number;
  accountId: Types.ObjectId; // FK ChartOfAccount — posts to GL on bill
  description?: string;
  /** Integer cents. */
  price: number;
  /** Integer cents — derived qty * price; recomputed in pre('validate'). */
  total: number;
}

export interface IChargeTarget {
  type: ChargeTargetType;
  id: Types.ObjectId;
}

export interface IWorkOrder {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  subject: string;
  vendorId: Types.ObjectId;
  status: WorkOrderStatus;
  priority: WorkPriority;
  dueDate?: Date | null;
  /** Required parent Task (BR-MV-5). */
  taskId: Types.ObjectId;
  /** Inherited from parent Task on creation; may diverge if PM edits. */
  taskType?: string;
  taskCategoryId?: Types.ObjectId | null;
  /** Required staff assignee (BR-MV-6). */
  assignedToUserId: Types.ObjectId;
  collaborators: Types.ObjectId[];
  workToBePerformed?: string;
  vendorNotes?: string;
  entryDetails?: EntryDetails;
  entryContacts: Types.ObjectId[]; // Tenant ids
  files: Types.ObjectId[];
  invoiceNumber?: string;
  chargeWorkTo?: IChargeTarget | null;
  partsAndLabor: IPartsAndLabor[];
  /** Cents — derived from partsAndLabor totals. */
  billTotal: number;
  billStatus: WorkOrderBillStatus;
  unitId?: Types.ObjectId | null;
  propertyId?: Types.ObjectId | null;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PartsAndLaborSchema = new Schema<IPartsAndLabor>(
  {
    qty: { type: Number, required: true, default: 1, min: 0 },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'PmChartOfAccount',
      required: true,
    },
    description: { type: String, trim: true, maxlength: 500 },
    price: { type: Number, required: true, default: 0, min: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: true },
);

const ChargeTargetSchema = new Schema<IChargeTarget>(
  {
    type: {
      type: String,
      enum: CHARGE_TARGET_TYPES_DB,
      required: true,
    },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const WorkOrderSchema = new Schema<IWorkOrder>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'PmOrganization',
      required: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: 'PmVendor',
      required: true,
    },
    status: {
      type: String,
      enum: WORK_ORDER_STATUSES_DB,
      required: true,
      default: 'New',
    },
    priority: {
      type: String,
      enum: WORK_PRIORITIES_DB,
      required: true,
      default: 'Normal',
    },
    dueDate: { type: Date, default: null },
    taskId: {
      type: Schema.Types.ObjectId,
      ref: 'PmTask',
      required: true,
    },
    taskType: { type: String, trim: true, maxlength: 60 },
    taskCategoryId: {
      type: Schema.Types.ObjectId,
      ref: 'PmTaskCategory',
      default: null,
    },
    assignedToUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    collaborators: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    workToBePerformed: { type: String, trim: true, maxlength: 4000 },
    vendorNotes: { type: String, trim: true, maxlength: 4000 },
    entryDetails: {
      type: String,
      enum: ENTRY_DETAILS_DB,
      default: undefined,
    },
    entryContacts: [{ type: Schema.Types.ObjectId, ref: 'PmTenant' }],
    files: [{ type: Schema.Types.ObjectId, ref: 'PmFile' }],
    invoiceNumber: { type: String, trim: true, maxlength: 60 },
    chargeWorkTo: { type: ChargeTargetSchema, default: null },
    partsAndLabor: {
      type: [PartsAndLaborSchema],
      default: [],
    },
    billTotal: { type: Number, default: 0 },
    billStatus: {
      type: String,
      enum: WORK_ORDER_BILL_STATUSES_DB,
      required: true,
      default: 'No bills added',
    },
    unitId: { type: Schema.Types.ObjectId, ref: 'PmUnit', default: null },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'PmProperty',
      default: null,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, collection: 'pm_work_orders' },
);

WorkOrderSchema.index({ organizationId: 1, status: 1, dueDate: 1 });
WorkOrderSchema.index({ organizationId: 1, vendorId: 1, status: 1 });
WorkOrderSchema.index({ organizationId: 1, taskId: 1 });
WorkOrderSchema.index({ organizationId: 1, propertyId: 1, status: 1 });

WorkOrderSchema.pre('validate', function (next) {
  // Recompute partsAndLabor totals + billTotal (BR-MV-8/9).
  let total = 0;
  for (const row of this.partsAndLabor ?? []) {
    if (!Number.isFinite(row.qty) || row.qty < 0) {
      return next(new Error('partsAndLabor.qty must be a non-negative number.'));
    }
    if (!Number.isFinite(row.price) || row.price < 0) {
      return next(new Error('partsAndLabor.price must be non-negative.'));
    }
    row.total = Math.round(row.qty * row.price);
    total += row.total;
  }
  this.billTotal = total;
  next();
});

export const WorkOrder: Model<IWorkOrder> =
  (models.PmWorkOrder as Model<IWorkOrder>) ??
  model<IWorkOrder>('PmWorkOrder', WorkOrderSchema);

export default WorkOrder;

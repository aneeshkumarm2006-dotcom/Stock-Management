// Zod validators for JournalEntry routes (BR-AC-1, BR-AC-14, PDR §3.19).
//
// Contract with the client:
//  - `date` arrives as an ISO string and is coerced server-side.
//  - `lines[].debit` / `lines[].credit` arrive in **dollars** (decimals). The
//    route multiplies by 100 → cents before persisting (see toCents in
//    lib/pm/currency.ts). The schema-layer validator re-checks the integer
//    balance in pre('validate'); these refinements are first-line defence
//    so the client gets clean field-level errors instead of a 500.
//  - `scopeId` is optional for Company scope (companyAccount auto-resolved
//    server-side); required for Property scope.
import { z } from 'zod';
import { Types } from 'mongoose';
import { JOURNAL_ENTRY_MEMO_MAX } from '@/lib/db/models/pm/JournalEntry';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const scopeType = z.enum(['Property', 'Company']);

const linePartial = z.object({
  accountId: objectIdString,
  scopeType,
  scopeId: objectIdString.nullable().optional(),
  unitId: objectIdString.nullable().optional(),
  name: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  debit: z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
});

const lineSchema = linePartial.superRefine((line, ctx) => {
  if (line.scopeType === 'Property' && !line.scopeId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Property-scoped lines require scopeId',
      path: ['scopeId'],
    });
  }
  const debitSet = line.debit > 0;
  const creditSet = line.credit > 0;
  if (debitSet && creditSet) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A line cannot have both a debit and a credit',
      path: ['credit'],
    });
  }
  if (!debitSet && !creditSet) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Each line needs either a debit or a credit',
      path: ['debit'],
    });
  }
});

const baseSchema = z.object({
  date: z.string().datetime({ offset: true }).or(z.string().min(8)),
  scopeType,
  scopeId: objectIdString.nullable().optional(),
  memo: z.string().max(JOURNAL_ENTRY_MEMO_MAX).optional(),
  attachmentFileId: objectIdString.nullable().optional(),
  lines: z.array(lineSchema).min(2, 'A journal entry requires at least two lines'),
  status: z.enum(['Posted', 'Draft']).default('Posted'),
});

function totalsCheck(
  data: { lines: { debit: number; credit: number }[] },
  ctx: z.RefinementCtx,
) {
  const totalDebits = data.lines.reduce((s, l) => s + Math.round(l.debit * 100), 0);
  const totalCredits = data.lines.reduce((s, l) => s + Math.round(l.credit * 100), 0);
  const hasDebit = data.lines.some((l) => l.debit > 0);
  const hasCredit = data.lines.some((l) => l.credit > 0);
  if (!hasDebit || !hasCredit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Need at least one debit and one credit line',
      path: ['lines'],
    });
  }
  if (totalDebits !== totalCredits) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unbalanced: totalDebits (${totalDebits / 100}) must equal totalCredits (${totalCredits / 100})`,
      path: ['lines'],
    });
  }
}

export const journalEntryCreateSchema = baseSchema.superRefine(totalsCheck);

export const journalEntryUpdateSchema = z
  .object({
    date: z.string().min(8).optional(),
    memo: z.string().max(JOURNAL_ENTRY_MEMO_MAX).optional(),
    attachmentFileId: objectIdString.nullable().optional(),
    lines: z.array(lineSchema).min(2).optional(),
    status: z.enum(['Posted', 'Draft']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  })
  .superRefine((d, ctx) => {
    if (d.lines) totalsCheck({ lines: d.lines }, ctx);
  });

export type JournalEntryCreate = z.infer<typeof journalEntryCreateSchema>;
export type JournalEntryUpdate = z.infer<typeof journalEntryUpdateSchema>;

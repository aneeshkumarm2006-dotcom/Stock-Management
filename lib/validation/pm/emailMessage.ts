// Zod validators for EmailMessage (PDR_MASTER §3.35, Phase 6).
//
// Create-time payloads come in three shapes: Draft (status='Draft', no
// recipients required), Scheduled (status='Scheduled' + scheduledSendTime
// required), and Send-now (status='Sent', at least one recipient).
// Validation is unified — additional rules run at the route handler so we
// can return precise 400s.
//
// Attachment caps ([G-S-45], confirmed Phase 6): max 10 files, 25 MB each,
// executable extensions denied. The byte-size cap is enforced when the
// route looks up each `PmFile` row — Zod only bounds the count + count of
// allowed extensions referenced through the file ids.
import { z } from 'zod';
import {
  EMAIL_RECIPIENT_TYPES,
  EMAIL_RELATED_ENTITY_TYPES,
  EMAIL_STATUSES,
} from '@/types/pm';
import { objectIdString } from './parentRef';

/** Resolves [G-S-45] — Phase 6 attachment caps. */
export const EMAIL_ATTACHMENT_MAX_COUNT = 10;
export const EMAIL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const EMAIL_ATTACHMENT_DENY_EXTENSIONS = [
  'exe',
  'bat',
  'cmd',
  'com',
  'scr',
  'js',
  'vbs',
  'ps1',
] as const;

export const emailRecipientSchema = z.object({
  type: z.enum(EMAIL_RECIPIENT_TYPES as readonly [string, ...string[]]),
  id: objectIdString.nullable(),
  email: z.string().trim().email(),
  name: z.string().trim().max(200).optional(),
});

const baseEmailFields = z.object({
  fromMailbox: z.string().trim().email(),
  fromMailboxPropertyId: objectIdString.optional().nullable(),
  subject: z.string().trim().min(1).max(500),
  to: z.array(emailRecipientSchema).default([]),
  cc: z.array(emailRecipientSchema).default([]),
  bcc: z.array(emailRecipientSchema).default([]),
  body: z.string().max(200_000).default(''),
  attachmentFileIds: z
    .array(objectIdString)
    .max(EMAIL_ATTACHMENT_MAX_COUNT, {
      message: `At most ${EMAIL_ATTACHMENT_MAX_COUNT} attachments allowed`,
    })
    .default([]),
  templateId: objectIdString.optional().nullable(),
  isSystemGenerated: z.boolean().optional(),
  relatedEntityType: z
    .enum(EMAIL_RELATED_ENTITY_TYPES as readonly [string, ...string[]])
    .optional()
    .nullable(),
  relatedEntityId: objectIdString.optional().nullable(),
});

export const emailMessageCreateSchema = baseEmailFields
  .extend({
    /** `send` → status='Sent', `schedule` → 'Scheduled', `draft` → 'Draft'. */
    action: z.enum(['send', 'schedule', 'draft']),
    scheduledSendTime: z.string().datetime().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.action === 'schedule' && !data.scheduledSendTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scheduledSendTime is required when action="schedule"',
        path: ['scheduledSendTime'],
      });
    }
    if (data.action === 'send' && data.to.length === 0 && data.cc.length === 0 && data.bcc.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one recipient is required to send',
        path: ['to'],
      });
    }
    if (
      (data.relatedEntityType && !data.relatedEntityId) ||
      (!data.relatedEntityType && data.relatedEntityId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relatedEntityType and relatedEntityId must be set together',
        path: ['relatedEntityType'],
      });
    }
  });

export const emailMessageUpdateSchema = baseEmailFields
  .partial()
  .extend({
    status: z.enum(EMAIL_STATUSES as readonly [string, ...string[]]).optional(),
    scheduledSendTime: z.string().datetime().optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

/** Inbound reply payload ([G-S-44] stub). Provider-agnostic shape — a real
 *  Postmark/SES adapter normalises the provider event into this schema. */
export const emailMessageIngestSchema = z.object({
  from: z.string().trim().email(),
  fromName: z.string().trim().max(200).optional(),
  to: z.array(z.string().trim().email()).min(1),
  subject: z.string().trim().min(1).max(500),
  body: z.string().max(200_000).default(''),
  inReplyTo: z.string().trim().max(500).optional(),
  references: z.array(z.string().trim().max(500)).optional(),
  receivedAt: z.string().datetime().optional(),
});

export type EmailMessageCreateInput = z.infer<typeof emailMessageCreateSchema>;
export type EmailMessageUpdateInput = z.infer<typeof emailMessageUpdateSchema>;
export type EmailMessageIngestInput = z.infer<typeof emailMessageIngestSchema>;

/** True iff `filename` ends in a denied extension. Server-side guard used
 *  by the compose route when looking up `PmFile` rows. */
export function hasDeniedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return EMAIL_ATTACHMENT_DENY_EXTENSIONS.some((ext) =>
    lower.endsWith(`.${ext}`),
  );
}

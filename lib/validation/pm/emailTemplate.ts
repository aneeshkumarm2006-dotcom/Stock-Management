// Zod validators for EmailTemplate (PDR_MASTER §3.36, Phase 6 skeleton).
import { z } from 'zod';
import { EMAIL_TEMPLATE_TYPES } from '@/types/pm';

export const emailTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(1).max(500),
  body: z.string().max(200_000).default(''),
  variables: z.array(z.string().trim().max(120)).default([]),
  type: z
    .enum(EMAIL_TEMPLATE_TYPES as readonly [string, ...string[]])
    .default('General'),
  audienceScope: z
    .enum(['Active tenants', 'All tenants', 'All owners', 'Vendors'])
    .optional()
    .nullable(),
});

export type EmailTemplateCreateInput = z.infer<typeof emailTemplateCreateSchema>;

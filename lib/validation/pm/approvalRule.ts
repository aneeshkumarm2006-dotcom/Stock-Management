// Zod validators for ApprovalRule (PDR BR-AC-19, [G-S-31]).
import { z } from 'zod';
import {
  APPROVAL_RULE_SCOPE_TYPES,
  APPROVAL_RULE_SEMANTICS,
} from '@/types/pm';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const approvalRuleCreateSchema = z
  .object({
    scopeType: z
      .enum(APPROVAL_RULE_SCOPE_TYPES as readonly [string, ...string[]])
      .default('Company'),
    scopeId: objectIdSchema.nullable().optional(),
    /** Threshold in dollars at the API boundary. */
    thresholdDollars: z.number().min(0).default(0),
    semantics: z
      .enum(APPROVAL_RULE_SEMANTICS as readonly [string, ...string[]])
      .default('any-of'),
    approverUserIds: z.array(objectIdSchema).min(1),
  })
  .refine(
    (d) => d.scopeType !== 'Property' || !!d.scopeId,
    {
      message: 'Property-scope rules require scopeId',
      path: ['scopeId'],
    },
  )
  .refine(
    (d) => d.scopeType !== 'Company' || !d.scopeId,
    {
      message: 'Company-scope rules must not carry scopeId',
      path: ['scopeId'],
    },
  );

export const approvalRuleUpdateSchema = z
  .object({
    thresholdDollars: z.number().min(0).optional(),
    semantics: z
      .enum(APPROVAL_RULE_SEMANTICS as readonly [string, ...string[]])
      .optional(),
    approverUserIds: z.array(objectIdSchema).min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type ApprovalRuleCreate = z.infer<typeof approvalRuleCreateSchema>;
export type ApprovalRuleUpdate = z.infer<typeof approvalRuleUpdateSchema>;

// Zod validators for Tenant (skeleton — PDR §3.5).
import { z } from 'zod';
import { TENANT_TYPES } from '@/types/pm';

const phoneSchema = z.object({
  number: z.string().max(40),
  smsOptIn: z.boolean().optional(),
});

const addressSchema = z.object({
  line1: z.string().max(120).optional(),
  line2: z.string().max(120).optional(),
  line3: z.string().max(120).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(2).optional(),
  zip: z.string().max(10).optional(),
  country: z.string().max(2).optional(),
});

const base = {
  // §1 — first/last are optional at the field level; the conditional rule
  // (Individual ⇒ first+last, Company ⇒ companyName) is enforced by the
  // shared `.superRefine` below.
  tenantType: z.enum(TENANT_TYPES as unknown as [string, ...string[]]).optional(),
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  companyName: z.string().min(1).max(200).optional(),
  contactPersonName: z.string().max(160).optional(),
  email: z.string().email().optional(),
  phones: z
    .object({
      mobile: phoneSchema.optional(),
      home: phoneSchema.optional(),
      work: phoneSchema.optional(),
      fax: phoneSchema.optional(),
    })
    .optional(),
  address: addressSchema.optional(),
  dateOfBirth: z.string().datetime().nullable().optional(),
  ssnLast4: z.string().regex(/^\d{4}$/).optional(),
  cosignerFlag: z.boolean().optional(),
  residentCenterAccess: z.boolean().optional(),
  customFields: z.record(z.unknown()).optional(),
};

/** §1 — conditional-required rule shared by create + update. On create an
 *  absent `tenantType` defaults to Individual (so names are required); on
 *  update an absent type means "unchanged" (no name rule fires). When the
 *  caller *explicitly* sets `tenantType` — i.e. a post-creation conversion —
 *  we enforce that type's required fields here so the request fails with a
 *  clean 400 instead of bubbling up as the model's pre('validate') error. */
function applyTenantTypeRule(isCreate: boolean) {
  return (
    data: {
      tenantType?: string;
      firstName?: string;
      lastName?: string;
      companyName?: string;
    },
    ctx: z.RefinementCtx,
  ): void => {
    const type = data.tenantType ?? (isCreate ? 'Individual' : undefined);
    if (type === 'Company') {
      if (!data.companyName || !data.companyName.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['companyName'],
          message: 'Company tenants require a company name.',
        });
      }
    } else if (type === 'Individual') {
      if (!data.firstName || !data.firstName.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['firstName'],
          message: 'Individual tenants require a first name.',
        });
      }
      if (!data.lastName || !data.lastName.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lastName'],
          message: 'Individual tenants require a last name.',
        });
      }
    }
  };
}

export const tenantCreateSchema = z
  .object(base)
  .superRefine(applyTenantTypeRule(true));

export const tenantUpdateSchema = z
  .object({
    ...base,
    active: z.boolean().optional(),
  })
  .superRefine(applyTenantTypeRule(false))
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type TenantCreate = z.infer<typeof tenantCreateSchema>;
export type TenantUpdate = z.infer<typeof tenantUpdateSchema>;

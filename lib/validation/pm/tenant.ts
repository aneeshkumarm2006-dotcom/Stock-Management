// Zod validators for Tenant (skeleton — PDR §3.5).
import { z } from 'zod';

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
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
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

export const tenantCreateSchema = z.object(base);

export const tenantUpdateSchema = z
  .object({
    ...base,
    firstName: base.firstName.optional(),
    lastName: base.lastName.optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type TenantCreate = z.infer<typeof tenantCreateSchema>;
export type TenantUpdate = z.infer<typeof tenantUpdateSchema>;

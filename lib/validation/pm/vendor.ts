// Zod validators for Vendor (PDR §3.11).
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

const insuranceSchema = z.object({
  provider: z.string().max(200).optional(),
  policyNumber: z.string().max(120).optional(),
  expirationDate: z.string().datetime().nullable().optional(),
});

const baseFields = {
  // first/last are optional at the field level; the conditional rule
  // (Individual ⇒ first+last, Company ⇒ companyName) is enforced by the
  // shared `.superRefine` below.
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  isCompany: z.boolean().optional(),
  companyName: z.string().max(160).optional(),
  categoryId: z.string().optional().nullable(),
  expenseAccountId: z.string().optional().nullable(),
  accountNumber: z.string().max(80).optional(),
  primaryEmail: z.string().email().optional(),
  alternateEmail: z.string().email().optional(),
  phones: z
    .object({
      mobile: phoneSchema.optional(),
      home: phoneSchema.optional(),
      work: phoneSchema.optional(),
      fax: phoneSchema.optional(),
    })
    .optional(),
  address: addressSchema.optional(),
  website: z.string().max(500).optional(),
  comments: z.string().max(4000).optional(),
  taxIdentityType: z.enum(['SSN', 'EIN', 'ITIN']).nullable().optional(),
  taxpayerIdLast4: z.string().regex(/^\d{4}$/).optional(),
  use1099AlternateName: z.boolean().optional(),
  alternativeName1099: z.string().max(160).optional(),
  use1099AlternateAddress: z.boolean().optional(),
  alternativeAddress1099: addressSchema.optional(),
  insurance: insuranceSchema.optional(),
  customFields: z.record(z.unknown()).optional(),
  vendorPortalAccess: z.boolean().optional(),
};

/** Conditional-required rule shared by create + update, keyed off `isCompany`.
 *  Company ⇒ companyName required; Individual ⇒ first + last required. On
 *  update an absent `isCompany` means "unchanged" (no rule fires). Enforcing it
 *  here gives a clean 400 instead of bubbling up the model's pre('validate'). */
function applyVendorTypeRule(isCreate: boolean) {
  return (
    data: {
      isCompany?: boolean;
      firstName?: string;
      lastName?: string;
      companyName?: string;
    },
    ctx: z.RefinementCtx,
  ): void => {
    const isCompany = data.isCompany ?? (isCreate ? false : undefined);
    if (isCompany === undefined) return;
    if (isCompany) {
      if (!data.companyName || !data.companyName.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['companyName'],
          message: 'companyName is required when isCompany=true',
        });
      }
    } else {
      if (!data.firstName || !data.firstName.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['firstName'],
          message: 'Individual vendors require a first name.',
        });
      }
      if (!data.lastName || !data.lastName.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lastName'],
          message: 'Individual vendors require a last name.',
        });
      }
    }
  };
}

export const vendorCreateSchema = z
  .object(baseFields)
  .superRefine(applyVendorTypeRule(true));

export const vendorUpdateSchema = z
  .object({
    firstName: baseFields.firstName.optional(),
    lastName: baseFields.lastName.optional(),
    isCompany: baseFields.isCompany,
    companyName: baseFields.companyName,
    categoryId: baseFields.categoryId,
    expenseAccountId: baseFields.expenseAccountId,
    accountNumber: baseFields.accountNumber,
    primaryEmail: baseFields.primaryEmail,
    alternateEmail: baseFields.alternateEmail,
    phones: baseFields.phones,
    address: baseFields.address,
    website: baseFields.website,
    comments: baseFields.comments,
    taxIdentityType: baseFields.taxIdentityType,
    taxpayerIdLast4: baseFields.taxpayerIdLast4,
    use1099AlternateName: baseFields.use1099AlternateName,
    alternativeName1099: baseFields.alternativeName1099,
    use1099AlternateAddress: baseFields.use1099AlternateAddress,
    alternativeAddress1099: baseFields.alternativeAddress1099,
    insurance: baseFields.insurance,
    customFields: baseFields.customFields,
    vendorPortalAccess: baseFields.vendorPortalAccess,
    /** PATCH-only — soft archive + reactivation per [G-B-3] (BR-MV-2). */
    active: z.boolean().optional(),
  })
  .superRefine(applyVendorTypeRule(false))
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type VendorCreate = z.infer<typeof vendorCreateSchema>;
export type VendorUpdate = z.infer<typeof vendorUpdateSchema>;

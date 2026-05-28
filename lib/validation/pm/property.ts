// Zod validators for Property routes. PDR §3.1; DECISIONS.md [G-S-24].
import { z } from 'zod';
import { objectIdString } from './parentRef';

const PROPERTY_CLASSES = ['Residential', 'Commercial'] as const;

const RESIDENT_CENTER_PAYMENT_HISTORY = [
  'Hidden',
  'Tenant can view current lease only',
  'Tenant can view all transactions',
] as const;

// Presence requirements lifted: address fields can be blank. The Zod schema
// keeps type/length guards only; missing-field cases surface as warnings via
// computeWarnings(). `state` still capped at 2 chars (format) but no longer
// requires presence.
const addressSchema = z.object({
  line1: z.string().max(120).optional(),
  line2: z.string().max(120).optional(),
  line3: z.string().max(120).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(2).optional(),
  zip: z.string().max(10).optional(),
  country: z.string().max(2).optional(),
});

const ownerJunctionSchema = z.object({
  rentalOwnerId: objectIdString,
  ownershipPct: z.number().min(0).max(100),
});

const residentRequestsSchema = z.object({
  enabled: z.boolean(),
  showEntryQuestions: z.boolean(),
});

const baseFields = {
  propertyName: z.string().max(200).optional(),
  propertyClass: z.enum(PROPERTY_CLASSES).optional(),
  // Subtype membership is no longer a hard error — it surfaces as the
  // SUBTYPE_CLASS_MISMATCH warning. Type stays string + max length to keep
  // payloads sane.
  propertySubType: z.string().max(80).optional(),
  address: addressSchema.optional(),
  photo: objectIdString.nullable().optional(),
  images: z.array(objectIdString).max(100).optional(),
  propertyManagerUserId: objectIdString.nullable().optional(),
  rentalOwners: z.array(ownerJunctionSchema).optional(),
  operatingAccountId: objectIdString.nullable().optional(),
  depositTrustAccountId: objectIdString.nullable().optional(),
  propertyReserve: z.number().min(0).optional(),
  listingDescription: z.string().max(8000).optional(),
  amenities: z.array(z.string().max(80)).optional(),
  includedInRent: z.array(z.string().max(80)).optional(),
  residentCenterPaymentHistory: z
    .enum(RESIDENT_CENTER_PAYMENT_HISTORY)
    .optional(),
  residentCenterRequests: residentRequestsSchema.optional(),
  residentCenterForums: z.boolean().optional(),
  rentersInsuranceMinLiability3rdParty: z.number().min(0).nullable().optional(),
  rentersInsuranceMinLiabilityMSI: z.number().min(0).nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
};

// Business-rule refinements (ownership-sum = 100, subtype matches class)
// were here as hard 400-on-violation. They now live in computeWarnings()
// as non-blocking amber warnings; the create endpoint stamps them on the
// new doc and returns them in the response.

export const propertyCreateSchema = z.object(baseFields);

export const propertyUpdateSchema = z
  .object({
    propertyName: baseFields.propertyName,
    propertyClass: baseFields.propertyClass,
    propertySubType: baseFields.propertySubType,
    address: baseFields.address,
    photo: baseFields.photo,
    images: baseFields.images,
    propertyManagerUserId: baseFields.propertyManagerUserId,
    rentalOwners: baseFields.rentalOwners,
    operatingAccountId: baseFields.operatingAccountId.optional(),
    depositTrustAccountId: baseFields.depositTrustAccountId,
    propertyReserve: baseFields.propertyReserve,
    listingDescription: baseFields.listingDescription,
    amenities: baseFields.amenities,
    includedInRent: baseFields.includedInRent,
    residentCenterPaymentHistory: baseFields.residentCenterPaymentHistory,
    residentCenterRequests: baseFields.residentCenterRequests,
    residentCenterForums: baseFields.residentCenterForums,
    rentersInsuranceMinLiability3rdParty:
      baseFields.rentersInsuranceMinLiability3rdParty,
    rentersInsuranceMinLiabilityMSI: baseFields.rentersInsuranceMinLiabilityMSI,
    customFields: baseFields.customFields,
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type PropertyCreate = z.infer<typeof propertyCreateSchema>;
export type PropertyUpdate = z.infer<typeof propertyUpdateSchema>;

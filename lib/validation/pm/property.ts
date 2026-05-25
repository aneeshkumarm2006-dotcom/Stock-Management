// Zod validators for Property routes. PDR §3.1; DECISIONS.md [G-S-24].
import { z } from 'zod';
import { objectIdString } from './parentRef';
import {
  COMMERCIAL_SUBTYPES,
  RESIDENTIAL_SUBTYPES,
} from '@/types/pm';

const PROPERTY_CLASSES = ['Residential', 'Commercial'] as const;
const ALL_SUBTYPES = [
  ...RESIDENTIAL_SUBTYPES,
  ...COMMERCIAL_SUBTYPES,
] as readonly string[];
const RES_SUBTYPES_SET = new Set<string>(RESIDENTIAL_SUBTYPES);
const COM_SUBTYPES_SET = new Set<string>(COMMERCIAL_SUBTYPES);

const RESIDENT_CENTER_PAYMENT_HISTORY = [
  'Hidden',
  'Tenant can view current lease only',
  'Tenant can view all transactions',
] as const;

const addressSchema = z.object({
  line1: z.string().min(1).max(120),
  line2: z.string().max(120).optional(),
  line3: z.string().max(120).optional(),
  city: z.string().min(1).max(80),
  state: z.string().min(2).max(2),
  zip: z.string().min(3).max(10),
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
  propertyName: z.string().min(1).max(200),
  propertyClass: z.enum(PROPERTY_CLASSES),
  propertySubType: z
    .string()
    .refine((v) => ALL_SUBTYPES.includes(v), 'Unknown propertySubType'),
  address: addressSchema,
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

function refineOwnerSum(
  d: { rentalOwners?: Array<{ ownershipPct: number }> },
): boolean {
  const list = d.rentalOwners ?? [];
  if (list.length === 0) return true;
  const sum = list.reduce((a, r) => a + (Number.isFinite(r.ownershipPct) ? r.ownershipPct : 0), 0);
  return Math.abs(sum - 100) <= 0.01;
}

function refineSubType(d: {
  propertyClass?: 'Residential' | 'Commercial';
  propertySubType?: string;
}): boolean {
  if (!d.propertyClass || !d.propertySubType) return true;
  if (d.propertyClass === 'Residential') return RES_SUBTYPES_SET.has(d.propertySubType);
  return COM_SUBTYPES_SET.has(d.propertySubType);
}

export const propertyCreateSchema = z
  .object(baseFields)
  .refine(refineOwnerSum, {
    message: 'Rental-owner ownershipPct must sum to 100%',
    path: ['rentalOwners'],
  })
  .refine(refineSubType, {
    message: 'propertySubType is not valid for the chosen propertyClass',
    path: ['propertySubType'],
  });

export const propertyUpdateSchema = z
  .object({
    propertyName: baseFields.propertyName.optional(),
    propertyClass: baseFields.propertyClass.optional(),
    propertySubType: baseFields.propertySubType.optional(),
    address: baseFields.address.optional(),
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
  .refine(refineOwnerSum, {
    message: 'Rental-owner ownershipPct must sum to 100%',
    path: ['rentalOwners'],
  })
  .refine(refineSubType, {
    message: 'propertySubType is not valid for the chosen propertyClass',
    path: ['propertySubType'],
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type PropertyCreate = z.infer<typeof propertyCreateSchema>;
export type PropertyUpdate = z.infer<typeof propertyUpdateSchema>;

// Zod validators for Listing (PDR §3.8). Money amounts flow in as dollars
// from the client and the route converts → cents.
import { z } from 'zod';
import { Types } from 'mongoose';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const base = {
  unitId: objectIdString,
  availableDate: z.string().min(8).nullable().optional(),
  listingRent: z.number().nonnegative().optional(),
  listingDeposit: z.number().nonnegative().optional(),
  contactName: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  unitAmenities: z.array(z.string().max(120)).max(100).optional(),
  unitDescription: z.string().max(8000).optional(),
  unitImages: z.array(objectIdString).max(50).optional(),
  leaseTermsBlurb: z.string().max(2000).optional(),
  customFields: z.record(z.unknown()).optional(),
};

export const listingCreateSchema = z.object(base);

export const listingUpdateSchema = z
  .object({
    ...base,
    unitId: base.unitId.optional(),
    listed: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type ListingCreate = z.infer<typeof listingCreateSchema>;
export type ListingUpdate = z.infer<typeof listingUpdateSchema>;

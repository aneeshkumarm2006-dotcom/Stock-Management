// Zod validators for Pet (PDR §3.32).
import { z } from 'zod';
import { Types } from 'mongoose';
import { PET_TYPES } from '@/types/pm';

const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const base = {
  leaseId: objectIdString,
  ownerTenantId: objectIdString.nullable().optional(),
  name: z.string().min(1).max(80),
  petType: z.enum(PET_TYPES as unknown as [string, ...string[]]),
  breed: z.string().max(80).optional(),
  weightLbs: z.number().min(0).max(500).optional(),
  ageYears: z.number().min(0).max(100).optional(),
  licenseNumber: z.string().max(80).optional(),
  assistanceAnimal: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
};

export const petCreateSchema = z.object(base);

export const petUpdateSchema = z
  .object({
    ...base,
    leaseId: base.leaseId.optional(),
    name: base.name.optional(),
    petType: base.petType.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

export type PetCreate = z.infer<typeof petCreateSchema>;
export type PetUpdate = z.infer<typeof petUpdateSchema>;

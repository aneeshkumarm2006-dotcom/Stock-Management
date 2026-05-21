// Reusable Zod fragments for polymorphic references and ObjectIds.
import { z } from 'zod';
import { Types } from 'mongoose';
import {
  parentTypeSchema,
  fileLocationTypeSchema,
} from '@/lib/pm/parentTypes';

export const objectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), 'Expected a 24-char ObjectId');

export const parentRefSchema = z.object({
  parentType: parentTypeSchema,
  parentId: objectIdString,
});

export const fileLocationRefSchema = z
  .object({
    locationType: fileLocationTypeSchema,
    locationId: objectIdString.nullable(),
  })
  .refine((d) => (d.locationType === 'Account' ? d.locationId == null : d.locationId != null), {
    message: 'locationId is required unless locationType is "Account"',
    path: ['locationId'],
  });

export type ParentRef = z.infer<typeof parentRefSchema>;
export type FileLocationRef = z.infer<typeof fileLocationRefSchema>;

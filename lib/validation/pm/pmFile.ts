import { z } from 'zod';
import { fileLocationTypeSchema } from '@/lib/pm/parentTypes';
import { objectIdString } from './parentRef';

export const pmFileCreateSchema = z
  .object({
    title: z.string().min(1).max(255),
    sharing: z.enum(['Internal', 'Resident', 'Owner', 'PublicLink']).optional(),
    categoryId: objectIdString,
    locationType: fileLocationTypeSchema,
    locationId: objectIdString.nullable(),
    mimeType: z.string().min(1).max(255),
    originalFilename: z.string().min(1).max(255),
    fileSize: z.number().int().min(0),
    storageKey: z.string().min(1),
  })
  .refine(
    (d) =>
      d.locationType === 'Account' ? d.locationId == null : d.locationId != null,
    {
      message: 'locationId is required unless locationType is "Account"',
      path: ['locationId'],
    },
  );

export const pmFileUpdateSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    sharing: z.enum(['Internal', 'Resident', 'Owner', 'PublicLink']).optional(),
    categoryId: objectIdString.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

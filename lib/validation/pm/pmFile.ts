import { z } from 'zod';
import { fileLocationTypeSchema } from '@/lib/pm/parentTypes';
import { objectIdString } from './parentRef';

// Presence requirements for categoryId and the "locationId required unless
// Account" refine moved to computeWarnings (FILE_MISSING_CATEGORY,
// FILE_MISSING_LOCATION). Storage-integrity fields (mimeType, originalFilename,
// fileSize, storageKey) stay required — file blob would be unrecoverable
// without them.
export const pmFileCreateSchema = z.object({
  title: z.string().max(255).optional(),
  sharing: z.enum(['Internal', 'Resident', 'Owner', 'PublicLink']).optional(),
  categoryId: objectIdString.optional(),
  locationType: fileLocationTypeSchema,
  locationId: objectIdString.nullable().optional(),
  mimeType: z.string().min(1).max(255),
  originalFilename: z.string().min(1).max(255),
  fileSize: z.number().int().min(0),
  storageKey: z.string().min(1),
  storageUrl: z.string().url().optional(),
  resourceType: z.enum(['image', 'video', 'raw']).optional(),
});

export const pmFileUpdateSchema = z
  .object({
    title: z.string().max(255).optional(),
    sharing: z.enum(['Internal', 'Resident', 'Owner', 'PublicLink']).optional(),
    categoryId: objectIdString.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'No fields to update',
  });

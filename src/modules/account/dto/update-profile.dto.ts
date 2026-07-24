/**
 * Update Profile DTO — request body schema for PUT /customers/profile.
 * Only contact info is editable (not identity). At least one field required.
 */
import { z } from 'zod';

export const UpdateProfileSchema = z
  .object({
    phone: z.string().min(1).optional(),
    email: z.string().email().optional(),
    contactAddress: z.string().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;

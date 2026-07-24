/**
 * Click-to-Call request DTO — body schema for POST /call-center/click-to-call.
 * Only the destination phone number is required.
 */
import { z } from 'zod';

export const ClickToCallRequestSchema = z.object({
  phoneNumber: z.string().min(1),
});

export type ClickToCallDto = z.infer<typeof ClickToCallRequestSchema>;

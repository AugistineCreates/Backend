import { z } from 'zod';

export const whatsappWebhookSchema = z.object({
  From: z.string().min(1, 'From is required'),
  Body: z.string().min(1, 'Body is required'),
});

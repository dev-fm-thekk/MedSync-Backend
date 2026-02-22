// schema.ts
// The "satisfies" keyword guarantees your Zod schema perfectly matches your TypeScript interface
import { z } from 'zod';
import { MintRecordInput, GrantAccessInput } from '../types.js';

export const mintSchema = z.object({
    patientAddress: z.string().startsWith('0x', 'Invalid address'),
    encryptedPayload: z.string().optional(),  // Optional when document sent via multipart
    metadata: z.object({
        recordType: z.string(),
        doctorId: z.string()
    }).optional(),
    account: z.string(),
});

export const grantAccessSchema = z.object({
    tokenId: z.number().int().nonnegative(),
    doctorAddress: z.string().startsWith('0x', 'Invalid address'),
    durationSeconds: z.number().int().positive(),
    account: z.string(),
}) satisfies z.ZodType<GrantAccessInput>;
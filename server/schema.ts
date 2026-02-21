// schema.ts
import { z } from 'zod';
import { MintRecordInput, GrantAccessInput } from './types.js';

// The "satisfies" keyword guarantees your Zod schema perfectly matches your TypeScript interface
export const mintSchema = z.object({
    patientAddress: z.string().startsWith('0x', 'Invalid address'),
    encryptedPayload: z.string().min(1, 'Payload required'),
    metadata: z.object({
        recordType: z.string(),
        doctorId: z.string()
    }).optional()
}) satisfies z.ZodType<MintRecordInput>;

export const grantAccessSchema = z.object({
    tokenId: z.number().int().nonnegative(),
    doctorAddress: z.string().startsWith('0x', 'Invalid address'),
    durationSeconds: z.number().int().positive()
}) satisfies z.ZodType<GrantAccessInput>;
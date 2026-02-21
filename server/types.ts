// types.ts
export interface MintRecordInput {
    patientAddress: string;
    encryptedPayload: string;
    metadata?: {
        recordType: string;
        doctorId: string;
    };
}

export interface GrantAccessInput {
    tokenId: number;
    doctorAddress: string;
    durationSeconds: number;
}
/**
 * @api {MedicalVault} v1 REST API Documentation
 * * OVERVIEW:
 * This API acts as the middleware between the Medical dApp Interface and the 
 * EVM Smart Contract. It handles Phase 2 (Hashing/IPFS) and Phase 3/4 (Contract Interaction).
 * * AUTHENTICATION:
 * All write endpoints require a 'X-Patient-Signature' or Bearer JWT from 
 * Account Abstraction providers (Privy/Magic).
 */

// --------------------------------------------------------------------------------
// 1. MINT RECORD
// --------------------------------------------------------------------------------

/**
 * @route   POST /v1/records/mint
 * @desc    Process medical data, upload to IPFS, and mint NFT via Paymaster.
 * * @inputData {
 * patientAddress: string;     // The Patient's Smart Contract Wallet (SCW) address
 * encryptedPayload: string;   // Data encrypted with Patient's Public Key (Base64)
 * metadata: object;           // Optional: { recordType: string, doctorId: string }
 * }
 * * @outputData {
 * success: boolean;
 * tokenId: number;            // The minted NFT ID
 * cid: string;                // IPFS link (e.g., ipfs://Qm...)
 * fileHash: string;           // SHA-256 integrity hash stored on-chain
 * txHash: string;             // Transaction hash from the blockchain
 * }
 * * @onError {
 * 400: "Invalid address format or missing payload"
 * 409: "Record hash already exists on-chain" (Data Integrity Guard)
 * 500: "IPFS upload failed" or "Paymaster sponsorship rejected"
 * }
 */

// --------------------------------------------------------------------------------
// 2. GRANT ACCESS
// --------------------------------------------------------------------------------

/**
 * @route   POST /v1/records/access/grant
 * @desc    Updates the Smart Contract to grant a 'Viewer' role to a doctor.
 * * @inputData {
 * tokenId: number;            // The ID of the medical NFT
 * doctorAddress: string;      // The wallet address of the receiving Doctor
 * durationSeconds: number;    // Time until access expires (e.g., 3600 for 1hr)
 * }
 * * @outputData {
 * status: "success";
 * expiry: number;             // Unix timestamp of expiration
 * txHash: string;
 * }
 * * @onError {
 * 401: "Caller is not the owner of this NFT"
 * 404: "Token ID not found"
 * 503: "Blockchain node connection timeout"
 * }
 */

// --------------------------------------------------------------------------------
// 3. RETRIEVE RECORD (DOCTOR VIEW)
// --------------------------------------------------------------------------------

/**
 * @route   GET /v1/records/:tokenId?doctorAddress=0x...
 * @desc    Retrieves IPFS metadata if the requesting doctor has active access.
 * * @inputData {
 * tokenId: number;            // Path parameter
 * doctorAddress: string;      // Query parameter for access verification
 * }
 * * @outputData {
 * cid: string;                // The IPFS URI needed for decryption
 * fileHash: string;           // The SHA-256 hash to verify data integrity
 * owner: string;              // The Patient's address
 * accessActive: boolean;      // Confirmation from hasAccess() contract call
 * }
 * * @onError {
 * 403: "Access denied: Doctor role expired or never granted"
 * 404: "Record not found"
 * }
 */

// --------------------------------------------------------------------------------
// 4. SYSTEM HEALTH
// --------------------------------------------------------------------------------

/**
 * @route   GET /v1/system/status
 * @desc    Returns status of IPFS gateway and Blockchain RPC provider.
 * * @outputData {
 * chain: "connected";
 * ipfs: "online";
 * contract: "0x...";          // Current MedicalVaultNFT address
 * }
 */
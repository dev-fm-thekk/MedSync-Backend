import { Router, Request, Response, NextFunction } from 'express';
import { mintSchema, grantAccessSchema } from '../utils/schema.js';
import { mintRecord, accessGrant, getRecordAccess, isContractLive } from '../action.js';
import { uploadEncryptedPayload } from '../utils/file.js';
import { documentUpload } from '../utils/upload.js';

const router = Router();

const MedVault_SC_Address: `0x${string}` = process.env.MEDIVAULT_SC_ADDRESS! as `0x${string}`;

/**
 * @api {MedicalVault} v1 REST API Documentation
 * * AUTHENTICATION: All write endpoints require a 'X-Patient-Signature' or Bearer JWT
 */
const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    // FIX: Safely extract the header and guarantee it is purely a string
    const rawAuth = req.headers['x-patient-signature'] || req.headers.authorization;
    const auth: string | undefined = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;

    if (!auth) {
        res.status(401).json({ error: "Unauthorized: Missing X-Patient-Signature or Bearer JWT" });
        return;
    }

    next();
};

const validateMintBody = (req: Request, res: Response, next: NextFunction): void => {
    const hasPayload = !!(req.body?.encryptedPayload?.length || (req as Request & { file?: { buffer: Buffer } }).file);
    if (!hasPayload) {

    // Ensure metadata for audit
        res.status(400).json({ error: "encryptedPayload or document file required" });
        return;
    }
    const validation = mintSchema.safeParse(req.body);
    const userId = req.params.id as string;
    if (!validation.success) {
        res.status(400).json({ error: "Invalid address format or missing fields", details: validation.error.errors });
        return;
    }
    const { patientAddress, metadata, account } = validation.data;
    (req as Request & { mintData?: { patientAddress: string; metadata: { recordType: string; doctorId: string }; account: string } }).mintData = {
        patientAddress,
        metadata: metadata ?? { recordType: "medical-record", doctorId: userId },
        account,
    };
    next();
};

const handleMintAfterUpload = async (req: Request, res: Response): Promise<void> => {
    const mintData = (req as Request & { mintData?: { patientAddress: string; metadata: { recordType: string; doctorId: string }; account: string } }).mintData;
    const userId = req.params.id as string;
    if (!mintData) {
        res.status(400).json({ error: "Validation data missing" });
        return;
    }
    const storagePath = req.body.encryptedPayload as string;
    const fileHashHex = req.fileHash;
    if (!fileHashHex) {
        res.status(500).json({ error: "Upload failed: no fileHash" });
        return;
    }
    const fileHash = `0x${fileHashHex}` as `0x${string}`;
    const result = await mintRecord(
        mintData.patientAddress,
        storagePath,
        fileHash,
        mintData.metadata,
        mintData.account as `0x${string}`,
        userId
    );
    if ('error' in result) {
        res.status(500).json({ error: result.error });
        return;
    }
    res.status(200).json({
        success: true,
        txHash: result.hash,
        receipt: result.receipt,
        message: result.message,
    });
};

/**
 * @route   POST /v1/records/:id/mint
 * @desc    Upload encrypted payload to Supabase Storage, then mint NFT to patient.
 * Flow: encryptedPayload → Supabase Storage → storagePath + fileHash on-chain.
 */
router.post('/v1/records/:id/mint', requireAuth, validateMintBody, uploadEncryptedPayload, handleMintAfterUpload);

/**
 * @route   POST /v1/records/:id/mint/file
 * @desc    Multipart: upload document file → encrypt/store in Supabase → mint NFT.
 * Form fields: patientAddress, account, recordType (opt), doctorId (opt)
 */
const normalizeMintFormData = (req: Request, _res: Response, next: NextFunction): void => {
    if (req.body?.recordType || req.body?.doctorId) {
        req.body.metadata = {
            recordType: req.body.recordType ?? 'medical-record',
            doctorId: req.body.doctorId ?? req.params.id,
        };
    }
    next();
};
router.post('/v1/records/:id/mint/file', requireAuth, documentUpload.single('document'), normalizeMintFormData, validateMintBody, uploadEncryptedPayload, handleMintAfterUpload);

/**
 * @route   POST /v1/records/access/grant
 * @desc    Updates the Smart Contract to grant a 'Viewer' role to a doctor.
 *
 * Expected body (validated by grantAccessSchema):
 *   - tokenId:           string         — NFT token ID of the record
 *   - doctorAddress:     string         — wallet address of the doctor
 *   - account:           `0x${string}` — signer wallet (must be record owner)
 *   - durationSeconds:   number         — how long the grant lasts in seconds
 */
router.post('/v1/records/access/:id/grant', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const validation = grantAccessSchema.safeParse(req.body);
    const userID = req.params.id as string;
    if (!validation.success) {
        res.status(400).json({ error: "Invalid input", details: validation.error.errors });
        return;
    }

    const { tokenId, doctorAddress, account, durationSeconds } = validation.data;
    const expiryUnix = Math.floor(Date.now() / 1000) + durationSeconds;

    const result = await accessGrant(tokenId, doctorAddress, account as `0x${string}`, durationSeconds, userID);

    if ('error' in result) {
        res.status(500).json({ error: result.error });
        return;
    }

    res.status(200).json({
        status: "success",
        expiry: expiryUnix,
        txHash: result.hash,
        receipt: result.receipt,
        message: result.message,
    });
});

/**
 * @route   GET /v1/records/:tokenId?doctorAddress=0x...
 * @desc    Retrieves IPFS metadata if the requesting doctor has active access.
 *
 * Params:
 *   - tokenId:       number (path param)
 * Query:
 *   - doctorAddress: `0x${string}`
 */
router.get('/v1/records/:tokenId', requireAuth, async (req: Request, res: Response): Promise<void> => {
    // FIX: Extract purely the string from params/queries to prevent array errors
    const rawTokenId = req.params.tokenId;
    const tokenIdStr = Array.isArray(rawTokenId) ? rawTokenId[0] : rawTokenId;
    const tokenId = parseInt(tokenIdStr as string);

    const rawDoctor = req.query.doctorAddress;
    const doctorAddress = Array.isArray(rawDoctor) ? rawDoctor[0] : (rawDoctor as string | undefined);

    if (isNaN(tokenId)) {
        res.status(404).json({ error: "Token ID not found" });
        return;
    }

    if (!doctorAddress || typeof doctorAddress !== 'string' || !doctorAddress.startsWith('0x')) {
        res.status(403).json({ error: "Access denied: Doctor role expired or never granted" });
        return;
    }

    const accessResult = await getRecordAccess(tokenId, doctorAddress);

    if (!accessResult.success) {
        res.status(500).json({ error: accessResult.error ?? "Failed to verify access on-chain" });
        return;
    }

    if (!accessResult.hasAccess) {
        res.status(403).json({ error: "Access denied: Doctor role expired or never granted" });
        return;
    }

    // TODO: Phase 2 — fetch real CID + fileHash from contract events or an off-chain index
    res.status(200).json({
        accessActive: true,
        tokenId,
        doctorAddress,
        cid: "ipfs://mock",       // replace with real IPFS lookup once Phase 2 is complete
        fileHash: "mock_hash",    // replace with real hash from IPFS/contract metadata
    });
});

/**
 * @route   GET /v1/system/status
 * @desc    Returns live status of the Blockchain RPC and deployed contract.
 */
router.get('/v1/system/status', async (req: Request, res: Response): Promise<void> => {
    const contractStatus = await isContractLive(MedVault_SC_Address);

    if ('error' in contractStatus) {
        res.status(500).json({ chain: "error", contract: "unknown", detail: contractStatus.error });
        return;
    }

    res.status(200).json({
        chain: "connected",
        ipfs: "online",                      // TODO: add real IPFS gateway health check in Phase 2
        contract: contractStatus.address ?? "not deployed",
        contractStatus: contractStatus.message,
    });
});

export default router;
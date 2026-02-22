import { Router, Request, Response, NextFunction } from 'express';
import { mintSchema, grantAccessSchema } from '../utils/schema.js';
import { mintRecord, accessGrant, getRecordAccess, isContractLive } from '../action.js';

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

/**
 * @route   POST /v1/records/mint
 * @desc    Process medical data, upload to IPFS, and mint NFT via Paymaster.
 *
 * Expected body (validated by mintSchema):
 *   - patientAddress:    `0x${string}` — wallet address of the patient
 *   - encryptedPayload:  string         — encrypted medical data / IPFS CID
 *   - metadata:          object         — arbitrary record metadata
 *   - account:           `0x${string}` — signer/minter wallet address
 */
router.post('/v1/records/:id/mint', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const validation = mintSchema.safeParse(req.body);
    const userId = req.params.id as string;
    if (!validation.success) {
        res.status(400).json({ error: "Invalid address format or missing payload", details: validation.error.errors });
        return;
    }

    const { patientAddress, encryptedPayload, metadata, account } = validation.data;
 
    const result = await mintRecord(patientAddress, encryptedPayload, metadata!, account as `0x${string}`, userId);

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
});

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
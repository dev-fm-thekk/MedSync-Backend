import { Router, Request, Response, NextFunction } from 'express';
import { mintSchema, grantAccessSchema } from './schema.js';

const router = Router();

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
 */
router.post('/v1/records/mint', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const validation = mintSchema.safeParse(req.body);
    
    if (!validation.success) {
        res.status(400).json({ error: "Invalid address format or missing payload", details: validation.error.errors });
        return;
    }

    // TODO: Phase 2 (Hashing/IPFS) and Phase 3/4 (Contract Interaction)
    res.status(200).json({ success: true, tokenId: 1, cid: "ipfs://mock", fileHash: "mock_hash", txHash: "0x..." });
});

/**
 * @route   POST /v1/records/access/grant
 * @desc    Updates the Smart Contract to grant a 'Viewer' role to a doctor.
 */
router.post('/v1/records/access/grant', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const validation = grantAccessSchema.safeParse(req.body);
    
    if (!validation.success) {
        res.status(400).json({ error: "Invalid input", details: validation.error.errors });
        return;
    }

    const expiryUnix = Math.floor(Date.now() / 1000) + validation.data.durationSeconds;
    res.status(200).json({ status: "success", expiry: expiryUnix, txHash: "0x..." });
});

/**
 * @route   GET /v1/records/:tokenId?doctorAddress=0x...
 * @desc    Retrieves IPFS metadata if the requesting doctor has active access.
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

    res.status(200).json({ cid: "ipfs://mock", fileHash: "mock_hash", owner: "0x...", accessActive: true });
});

/**
 * @route   GET /v1/system/status
 * @desc    Returns status of IPFS gateway and Blockchain RPC provider.
 */
router.get('/v1/system/status', async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({ chain: "connected", ipfs: "online", contract: "0x..." });
});

export default router;
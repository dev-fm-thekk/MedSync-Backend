import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';

dotenv.config();

// ── Supabase client ───────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Bucket name — create this in Supabase Dashboard → Storage → New bucket
// Recommended settings: private bucket, no public access
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'medical-records';

// ── Types ─────────────────────────────────────────────────────────────────────

// Augment Express Request so downstream route handlers can read the
// processed fields without casting req.body repeatedly
declare global {
  namespace Express {
    interface Request {
      fileHash?:      string;  // SHA-256 hex of the encrypted payload
      storagePath?:   string;  // path inside the Supabase bucket
      storageUrl?:    string;  // signed URL (1 hour) for immediate verification
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * SHA-256 hash of bytes → lowercase hex string.
 */
function sha256FromBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Parse payload: base64 string → Buffer, or UTF-8 string → Buffer.
 */
function payloadToBuffer(encryptedPayload: string, fileBuffer?: Buffer): Buffer {
  if (fileBuffer) return fileBuffer;
  if (/^[A-Za-z0-9+/]+=*$/.test(encryptedPayload.replace(/\s/g, ''))) {
    return Buffer.from(encryptedPayload, 'base64');
  }
  return Buffer.from(encryptedPayload, 'utf8');
}

/**
 * Build a deterministic storage path:
 *   medical-records/{userId}/{sha256hash}.enc
 *
 * Using the hash as the filename means:
 *   - Uploading the same payload twice overwrites idempotently (upsert: true)
 *   - Files are naturally deduped per user
 */
function buildStoragePath(userId: string, hash: string): string {
  return `${userId}/${hash}.enc`;
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * uploadEncryptedPayload
 *
 * Sits between requireAuth and the mintRecord route handler on:
 *   POST /v1/records/:id/mint
 *
 * What it does:
 *   1. Reads `encryptedPayload` from req.body
 *   2. Computes SHA-256 hash of the payload
 *   3. Uploads the raw payload to Supabase Storage as a private .enc file
 *   4. Attaches { fileHash, storagePath, storageUrl } to the request object
 *   5. Replaces req.body.encryptedPayload with the storagePath so the
 *      route handler can pass the storage reference to the smart contract
 *      instead of the raw payload
 *
 * On any failure it responds with 500 and halts the chain — the mint
 * should never proceed if the file wasn't stored successfully.
 */
export async function uploadEncryptedPayload(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const encryptedPayload: string | undefined = req.body?.encryptedPayload;
  const fileFromMulter = (req as Request & { file?: { buffer: Buffer } }).file?.buffer;
  const userId: string | undefined           = req.params?.id as string;

  if (!encryptedPayload && !fileFromMulter) {
    res.status(400).json({ error: 'encryptedPayload (JSON) or document file (multipart) required' });
    return;
  }
  if (!userId) {
    res.status(400).json({ error: 'User ID path param (:id) is missing' });
    return;
  }

  try {
    const fileBuffer = payloadToBuffer(encryptedPayload ?? '', fileFromMulter);

    // ── Step 1: Hash ──────────────────────────────────────────────────
    const fileHash    = sha256FromBuffer(fileBuffer);
    const storagePath = buildStoragePath(userId, fileHash);

    // ── Step 2: Upload to Supabase Storage ────────────────────────────

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType:  'application/octet-stream',
        upsert:       true,   // idempotent — same hash → same file, safe to overwrite
        cacheControl: '3600',
        metadata: {
          userId,
          sha256: fileHash,
          uploadedAt: new Date().toISOString(),
        },
      });

    if (uploadError) {
      console.error('[uploadEncryptedPayload] Storage upload error:', uploadError.message);
      res.status(500).json({ error: 'Failed to upload encrypted payload to storage', detail: uploadError.message });
      return;
    }

    // ── Step 3: Generate a short-lived signed URL (optional, for verification) ──
    const { data: signedUrlData, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600); // 1 hour

    if (urlError) {
      // Non-fatal — upload succeeded, URL generation is best-effort
      console.warn('[uploadEncryptedPayload] Could not generate signed URL:', urlError.message);
    }

    // ── Step 4: Attach to request for downstream handlers ─────────────
    req.fileHash    = fileHash;
    req.storagePath = storagePath;
    req.storageUrl  = signedUrlData?.signedUrl;

    // Replace raw payload with the storage path — the smart contract stores
    // this reference rather than the actual encrypted data
    req.body.encryptedPayload = storagePath;

    console.log(`[uploadEncryptedPayload] Stored ${storagePath} (sha256: ${fileHash})`);

    next();

  } catch (err) {
    console.error('[uploadEncryptedPayload] Unexpected error:', err);
    res.status(500).json({
      error: 'Unexpected error during payload upload',
      detail: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
import express from 'express';
import multer, { FileFilterCallback } from 'multer';
import router from './routes/access-route.js';

const app = express();

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Multer — memory storage ───────────────────────────────────────────────────
// Files land in req.file / req.files as Buffer — no disk writes needed since
// the middleware immediately streams them to Supabase Storage.

const FIVE_MB = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize:  FIVE_MB,   // max 5 MB per file
    files:     1,         // only one file per mint request
  },

  fileFilter: (_req: express.Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    // Accept only .enc files or generic binary/octet-stream
    const allowedMimes = [
      'application/octet-stream',
      'application/encrypted',
      'text/plain',           // allow base64-encoded payloads sent as text
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Send application/octet-stream or text/plain.`));
    }
  },
});

// ── Export for use in middleware.ts ───────────────────────────────────────────
// The mint route uses upload.single('encryptedPayload') so req.file holds
// the uploaded buffer that middleware.ts then hashes and pushes to Supabase.
export { upload };

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', router);

// ── Multer error handler ──────────────────────────────────────────────────────
// Must be defined AFTER routes and have 4 params for Express to treat it as
// an error handler.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors (file too large, too many files, etc.)
    res.status(400).json({ error: `Upload error: ${err.message}`, code: err.code });
    return;
  }
  if (err) {
    // fileFilter rejections and other errors
    res.status(400).json({ error: err.message });
    return;
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(8080, () => console.log('Server listening on http://localhost:8080'));

export default app;
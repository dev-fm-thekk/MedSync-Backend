import express from 'express';
import multer, { FileFilterCallback } from 'multer';
import accessRouter from './routes/access-route.js';
import appointmentRouter from './routes/appointment-route.js';

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Patient-Signature');
  if (_req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Multer — memory storage ───────────────────────────────────────────────────
const FIVE_MB = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FIVE_MB, files: 1 },
  fileFilter: (_req: express.Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowedMimes = [
      'application/octet-stream',
      'application/encrypted',
      'text/plain',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

export { upload };

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', accessRouter);
app.use('/api', appointmentRouter);

// ── Multer error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: `Upload error: ${err.message}`, code: err.code });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message });
    return;
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(8080, () => console.log('Server listening on http://localhost:8080'));

export default app;

import multer, { FileFilterCallback } from 'multer';
import express from 'express';

const FIVE_MB = 5 * 1024 * 1024;

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FIVE_MB, files: 1 },
  fileFilter: (_req: express.Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = [
      'application/octet-stream',
      'application/encrypted',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'text/plain',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

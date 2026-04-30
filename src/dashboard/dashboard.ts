import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

const router = Router();

// Serve the admin dashboard SPA
router.get('/', (_req: Request, res: Response) => {
  const htmlPath = path.resolve(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(htmlPath);
  } else {
    res.status(404).send('Dashboard not found. Build the dashboard first.');
  }
});

export default router;

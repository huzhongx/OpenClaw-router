import { Router, Request, Response } from 'express';
import { getDb } from '../../db/connection';
import { adminAuth } from '../../middleware/admin-auth';
import { getAllQualityScores, setQualityOverride, deleteQualityOverride } from '../../services/quality-scores';

const router = Router();
router.use(adminAuth);

router.get('/scores', (_req: Request, res: Response) => {
  res.json({ scores: getAllQualityScores() });
});

router.put('/overrides/:modelId', (req: Request, res: Response) => {
  const { quality_score, notes } = req.body;
  if (typeof quality_score !== 'number' || quality_score < 0 || quality_score > 100) {
    res.status(400).json({ error: { message: 'quality_score must be between 0 and 100' } });
    return;
  }
  setQualityOverride(req.params.modelId as string, quality_score, notes);
  res.json({ success: true });
});

router.delete('/overrides/:modelId', (req: Request, res: Response) => {
  deleteQualityOverride(req.params.modelId as string);
  res.json({ success: true });
});

export default router;

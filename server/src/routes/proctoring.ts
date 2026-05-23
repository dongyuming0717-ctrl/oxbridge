import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';

const router = Router();

// Start a proctoring session
router.post('/session/start', (req: Request, res: Response) => {
  const { exam_id, user_id } = req.body;
  if (!exam_id || !user_id) {
    res.status(400).json({ error: 'exam_id and user_id are required' });
    return;
  }

  const id = uuid();
  db.prepare(
    'INSERT INTO proctoring_sessions (id, exam_id, user_id) VALUES (?, ?, ?)'
  ).run(id, exam_id, user_id);

  res.json({ session_id: id, status: 'active' });
});

// End a proctoring session
router.post('/session/end', (req: Request, res: Response) => {
  const { session_id } = req.body;
  if (!session_id) {
    res.status(400).json({ error: 'session_id is required' });
    return;
  }

  db.prepare(
    "UPDATE proctoring_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?"
  ).run(session_id);

  res.json({ session_id, status: 'ended' });
});

// Report a violation
router.post('/violation', (req: Request, res: Response) => {
  const { session_id, type, detail } = req.body;
  if (!session_id || !type) {
    res.status(400).json({ error: 'session_id and type are required' });
    return;
  }

  const result = db.prepare(
    'INSERT INTO violations (session_id, type, detail) VALUES (?, ?, ?)'
  ).run(session_id, type, detail || '');

  res.json({ violation_id: result.lastInsertRowid, recorded: true });
});

// Get session summary with violations
router.get('/session/:id', (req: Request, res: Response) => {
  const session = db.prepare(
    'SELECT * FROM proctoring_sessions WHERE id = ?'
  ).get(req.params.id) as any;

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const violations = db.prepare(
    'SELECT * FROM violations WHERE session_id = ? ORDER BY recorded_at DESC'
  ).all(req.params.id);

  res.json({ ...session, violations });
});

export default router;

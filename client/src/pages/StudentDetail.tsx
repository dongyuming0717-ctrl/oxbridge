import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { MathText } from '../components/MathText';
import type { Paper, Question } from '../sdk/types';

interface SessionDetail {
  id: string;
  user_id: string;
  paper_id: string;
  status: string;
  answers: Record<string, number>;
  question_times: Record<string, number>;
  score: number | null;
  started_at: string;
  ended_at: string | null;
  users: { full_name: string; email: string };
  papers: { title: string; paper_number: number; questions: Question[] };
}

interface LogEntry {
  id: number;
  event_type: string;
  detail: any;
  severity: string;
  recorded_at: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: '#f59e0b',
  medium: '#f97316',
  high: '#ef4444',
};

export function StudentDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) return;

    async function load() {
      setLoading(true);
      setError('');

      // Fetch session
      const { data: sessionData, error: sessionError } = await supabase
        .from('exam_sessions')
        .select('id, user_id, paper_id, status, answers, question_times, score, started_at, ended_at, users(full_name, email), papers(title, paper_number, questions)')
        .eq('id', sessionId)
        .single();

      if (sessionError || !sessionData) {
        setError(sessionError?.message || 'Session not found');
        setLoading(false);
        return;
      }

      setSession(sessionData as unknown as SessionDetail);

      // Fetch logs
      const { data: logData } = await supabase
        .from('exam_logs')
        .select('*')
        .eq('session_id', sessionId)
        .order('recorded_at', { ascending: false });

      setLogs((logData || []) as LogEntry[]);
      setLoading(false);
    }

    load();
  }, [sessionId]);

  if (loading) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 40, textAlign: 'center', color: '#9ca3af' }}>
        Loading student details...
      </div>
    );
  }

  if (error || !session) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 500, margin: '60px auto', textAlign: 'center' }}>
        <p style={{ color: '#dc2626' }}>{error || 'Session not found'}</p>
        <button
          onClick={() => navigate('/admin')}
          style={{
            padding: '6px 20px', background: '#2563eb', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', marginTop: 8,
          }}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const questions = session.papers?.questions || [];
  const answers = session.answers || {};
  const questionTimes = session.question_times || {};

  let correctCount = 0;
  const details = questions.map((q, i) => {
    const yours = answers[q.id] ?? null;
    const isCorrect = yours === q.answer;
    if (isCorrect) correctCount++;
    return { ...q, index: i, yours, isCorrect, timeMs: questionTimes[q.id] || 0 };
  });

  const totalQuestions = questions.length;
  const scorePercent = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f9fafb' }}>
      {/* Header */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <button
          onClick={() => navigate('/admin')}
          style={{
            padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6,
            background: '#fff', cursor: 'pointer', fontSize: 13,
          }}
        >
          ← Back
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>
            {session.users?.full_name || 'Unknown'}
          </h1>
          <p style={{ margin: '2px 0 0', color: '#6b7280', fontSize: 12 }}>
            {session.users?.email} &middot; {session.papers?.title}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 28, fontWeight: 700,
            color: scorePercent >= 80 ? '#16a34a' : scorePercent >= 50 ? '#f59e0b' : '#ef4444',
          }}>
            {correctCount}/{totalQuestions} ({scorePercent}%)
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Status: {session.status} &middot; {session.ended_at ? `Ended ${new Date(session.ended_at).toLocaleString()}` : 'In progress'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, padding: 20, maxWidth: 1400, margin: '0 auto' }}>
        {/* Answers Breakdown */}
        <div style={{ flex: 2 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 12px 0' }}>Answers Breakdown</h2>
          {details.map((d) => (
            <div
              key={d.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', marginBottom: 6, borderRadius: 8,
                background: d.yours === null ? '#f9fafb' : d.isCorrect ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${d.yours === null ? '#e5e7eb' : d.isCorrect ? '#bbf7d0' : '#fecaca'}`,
              }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 12,
                fontWeight: 700, flexShrink: 0,
                background:
                  d.yours === null ? '#e5e7eb' :
                  d.isCorrect ? '#16a34a' : '#ef4444',
                color: d.yours === null ? '#9ca3af' : '#fff',
              }}>
                {d.yours === null ? '?' : d.isCorrect ? '✓' : '✗'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Q{d.index + 1}
                </span>
                <span style={{ fontSize: 13, color: '#4b5563', marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <MathText text={d.text} />
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', flexShrink: 0, textAlign: 'right' }}>
                <div>
                  {d.yours !== null ? `Yours: ${String.fromCharCode(65 + d.yours)}` : 'Skipped'}
                  {' · '}
                  Answer: {String.fromCharCode(65 + d.answer)}
                </div>
                {d.timeMs > 0 && (
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>
                    {Math.round(d.timeMs / 1000)}s spent
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Violations Panel */}
        <div style={{ flex: 1, minWidth: 300 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 12px 0' }}>
            Violations ({logs.length})
          </h2>
          {logs.length === 0 ? (
            <div style={{
              padding: 20, background: '#f0fdf4', borderRadius: 10,
              border: '1px solid #bbf7d0', textAlign: 'center', color: '#16a34a', fontSize: 14,
            }}>
              No violations recorded
            </div>
          ) : (
            <div style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
              {logs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    padding: '10px 12px', marginBottom: 6, borderRadius: 8,
                    background: '#fff', border: '1px solid #e5e7eb',
                    borderLeft: `3px solid ${SEVERITY_COLORS[log.severity] || '#9ca3af'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#1f2937' }}>
                      {log.event_type.replace(/_/g, ' ')}
                    </span>
                    <span style={{
                      fontSize: 11, padding: '1px 8px', borderRadius: 99,
                      background: SEVERITY_COLORS[log.severity] + '20',
                      color: SEVERITY_COLORS[log.severity],
                      fontWeight: 600,
                    }}>
                      {log.severity}
                    </span>
                  </div>
                  {log.detail?.message && (
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280' }}>
                      {log.detail.message}
                    </p>
                  )}
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9ca3af' }}>
                    {new Date(log.recorded_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

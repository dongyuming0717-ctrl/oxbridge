import { useEffect, useState, useCallback, useRef } from 'react';
import { useProctor } from '../sdk/useProctor';
import { TabSwitchDetector } from '../sdk/TabSwitchDetector';
import { WebcamCapture } from '../sdk/WebcamCapture';
import { ViolationLog } from './ViolationLog';
import { ViolationAlert } from './ViolationAlert';
import { PreExamCheck } from './PreExamCheck';
import { MathText } from '../components/MathText';
import { StudentAuth } from './StudentAuth';
import { generateExamReport } from '../utils/generateReport';
import type { Paper, Question } from '../sdk/types';

const PAPERS_CACHE_KEY = 'tmua_papers_cache';
const CACHE_TTL_MS = 5 * 60 * 1000;

function loadCachedPapers(): Paper[] | null {
  try {
    const raw = localStorage.getItem(PAPERS_CACHE_KEY);
    if (!raw) return null;
    const { papers, ts } = JSON.parse(raw);
    if (Date.now() - ts < CACHE_TTL_MS) return papers;
  } catch { /* ignore */ }
  return null;
}

function saveCachedPapers(papers: Paper[]) {
  try {
    localStorage.setItem(PAPERS_CACHE_KEY, JSON.stringify({ papers, ts: Date.now() }));
  } catch { /* ignore */ }
}

export function ExamPage() {
  const { supabase, user, status, sessionId, startSession, endSession, resetSession } = useProctor();

  const [papers, setPapers] = useState<Paper[]>(() => loadCachedPapers() || []);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [examStarted, setExamStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [userProfileId, setUserProfileId] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<'loading' | 'done' | 'error'>('loading');
  const [showPreCheck, setShowPreCheck] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [finalTotal, setFinalTotal] = useState(0);
  const [scoreDetails, setScoreDetails] = useState<{ qid: string; text: string; correct: number; yours: number | null }[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const questionTimesRef = useRef<Record<string, number>>({});
  const activeQStartRef = useRef<number>(0);
  const isTabHiddenRef = useRef<boolean>(false);
  const [finalQuestionTimes, setFinalQuestionTimes] = useState<Record<string, number>>({});

  // Fetch papers from Supabase (with cache + timeout)
  useEffect(() => {
    const cached = loadCachedPapers();
    if (cached) {
      setPapers(cached);
      setFetchState('done');
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);

    async function load() {
      try {
        const { data, error } = await supabase
          .from('papers')
          .select('*')
          .order('year', { ascending: false })
          .order('paper_number')
          .abortSignal(ctrl.signal);

        if (!error && data) {
          setPapers(data as Paper[]);
          saveCachedPapers(data as Paper[]);
          setFetchState('done');
        } else if (!cached) {
          setFetchState('error');
        }
      } catch {
        if (!cached) setFetchState('error');
      }
      clearTimeout(timer);
    }

    if (!cached) load();
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [supabase]);

  const retryFetch = useCallback(async () => {
    setFetchState('loading');
    try {
      const { data, error } = await supabase.from('papers').select('*')
        .order('year', { ascending: false })
        .order('paper_number');
      if (!error && data) {
        setPapers(data as Paper[]);
        saveCachedPapers(data as Paper[]);
        setFetchState('done');
      } else {
        setFetchState('error');
      }
    } catch {
      setFetchState('error');
    }
  }, [supabase]);

  // Fetch app-level user profile ID when auth user changes
  useEffect(() => {
    if (!user) { setUserProfileId(null); return; }
    supabase.from('users').select('id').eq('auth_id', user.id).single()
      .then(({ data }) => { if (data) setUserProfileId(data.id); });
  }, [user, supabase]);

  // Start exam — immediately activate everything, Supabase is async in background
  const beginExam = useCallback(() => {
    if (!selectedPaper || !userProfileId) return;

    const qs = selectedPaper.questions as Question[];
    setQuestions(qs);
    setAnswers({});
    setCurrentQ(0);
    setSelected(null);
    setExamStarted(true);
    setTimeLeft(selectedPaper.duration_minutes * 60);

    questionTimesRef.current = {};
    activeQStartRef.current = Date.now();
    isTabHiddenRef.current = false;

    startSession(selectedPaper.id, userProfileId);
  }, [selectedPaper, userProfileId, startSession]);

  const accumulateCurrentQTime = useCallback(() => {
    if (!examStarted || isTabHiddenRef.current) return;
    const qId = questions[currentQ]?.id;
    if (!qId) return;
    const now = Date.now();
    const elapsed = now - activeQStartRef.current;
    questionTimesRef.current[qId] = (questionTimesRef.current[qId] || 0) + elapsed;
    activeQStartRef.current = now;
  }, [examStarted, questions, currentQ]);

  // Timer — runs independently, driven by examStarted + timeLeft
  useEffect(() => {
    if (!examStarted || timeLeft <= 0) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [examStarted]);

  // Pause per-question timing when tab is hidden
  useEffect(() => {
    if (!examStarted) return;

    const handleVisibility = () => {
      if (document.hidden) {
        accumulateCurrentQTime();
        isTabHiddenRef.current = true;
      } else {
        isTabHiddenRef.current = false;
        activeQStartRef.current = Date.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [examStarted, accumulateCurrentQTime]);

  // Auto-save to Supabase every 30s
  useEffect(() => {
    if (!examStarted || !sessionId) return;

    const id = setInterval(() => {
      supabase
        .from('exam_sessions')
        .update({ answers })
        .eq('id', sessionId)
        .then(() => {});
    }, 30000);

    return () => clearInterval(id);
  }, [examStarted, sessionId, answers, supabase]);

  // Time's up → submit
  useEffect(() => {
    if (examStarted && timeLeft <= 0) {
      finishExam();
    }
  }, [timeLeft]);

  const selectAnswer = useCallback(
    (questionId: string, optionIndex: number) => {
      setSelected(optionIndex);
      setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
    },
    [],
  );

  const finishExam = useCallback(() => {
    if (!selectedPaper) return;

    accumulateCurrentQTime();
    const qTimes = { ...questionTimesRef.current };

    const qs = selectedPaper.questions as Question[];
    let score = 0;
    const details = qs.map((q) => {
      const isCorrect = answers[q.id] === q.answer;
      if (isCorrect) score++;
      return { qid: q.id, text: q.text, correct: q.answer, yours: answers[q.id] ?? null };
    });

    setFinalScore(score);
    setFinalTotal(qs.length);
    setScoreDetails(details);
    setFinalQuestionTimes(qTimes);

    if (sessionId) {
      supabase
        .from('exam_sessions')
        .update({ answers, score, question_times: qTimes, status: 'completed', ended_at: new Date().toISOString() })
        .eq('id', sessionId)
        .then(() => {});
    }

    endSession();
    if (timerRef.current) clearInterval(timerRef.current);

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, [selectedPaper, sessionId, answers, supabase, endSession, accumulateCurrentQTime]);

  // ---- Auth Gate: require login before anything ----
  if (!user) {
    return <StudentAuth />;
  }

  // ---- Pre-Exam Check Screen ----
  if (showPreCheck && !examStarted) {
    return (
      <PreExamCheck
        onComplete={() => {
          setShowPreCheck(false);
          beginExam();
        }}
        onBack={() => setShowPreCheck(false)}
      />
    );
  }

  // ---- Paper Selection Screen ----
  const paperColor = (paper: Paper) => {
    if (paper.paper_number === 1) return { bg: '#eff6ff', accent: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' };
    return { bg: '#f0fdf4', accent: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e, #15803d)' };
  };

  if (!examStarted) {
    return (
      <div style={{ minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif", background: '#f8fafc' }}>
        {/* Top Nav */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16,
          padding: '12px 32px', background: '#fff', borderBottom: '1px solid #e2e8f0',
        }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>{user?.email}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              padding: '6px 16px', border: '1px solid #e2e8f0', borderRadius: 8,
              background: '#fff', cursor: 'pointer', fontSize: 13, color: '#64748b',
              fontWeight: 500, transition: 'all 0.2s',
            }}
          >
            Sign Out
          </button>
        </div>

        {/* Hero */}
        <div style={{
          textAlign: 'center', padding: '48px 24px 40px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #1e3a5f 100%)',
          color: '#fff',
        }}>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 800, letterSpacing: -1 }}>
            TMUA Practice Papers
          </h1>
          <p style={{ margin: '12px 0 0', color: '#94a3b8', fontSize: 16, fontWeight: 400 }}>
            Select a paper to begin your proctored exam session
          </p>
          {papers.length > 0 && (
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 16 }}>
              <div style={{
                background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 24px',
                border: '1px solid rgba(255,255,255,0.1)',
              }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{papers.length}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Papers</div>
              </div>
              <div style={{
                background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 24px',
                border: '1px solid rgba(255,255,255,0.1)',
              }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>
                  {papers.reduce((s, p) => s + (p.questions as Question[]).length, 0)}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Questions</div>
              </div>
            </div>
          )}
        </div>

        {/* Paper List */}
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 20px 60px' }}>
          {fetchState === 'error' ? (
            <div style={{ textAlign: 'center', padding: 40, background: '#fef2f2', borderRadius: 12, border: '1px solid #fecaca' }}>
              <p style={{ color: '#dc2626', marginBottom: 8 }}>Failed to load papers</p>
              <button onClick={retryFetch} style={{ padding: '6px 20px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Retry</button>
            </div>
          ) : fetchState === 'loading' && papers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>&#8987;</div>
              <p>Loading papers...</p>
            </div>
          ) : papers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <p style={{ color: '#64748b' }}>No papers available yet.</p>
              <p style={{ fontSize: 13, color: '#94a3b8' }}>
                Run the SQL schema in your Supabase SQL Editor to seed sample papers.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {papers.map((paper) => {
                const colors = paperColor(paper);
                const isSelected = selectedPaper?.id === paper.id;
                const qCount = (paper.questions as Question[]).length;
                return (
                  <div
                    key={paper.id}
                    onClick={() => setSelectedPaper(paper)}
                    style={{
                      display: 'flex', alignItems: 'stretch', borderRadius: 14,
                      cursor: 'pointer', overflow: 'hidden',
                      background: '#fff',
                      border: `2px solid ${isSelected ? colors.accent : '#e2e8f0'}`,
                      boxShadow: isSelected
                        ? `0 4px 20px rgba(0,0,0,0.08), 0 0 0 1px ${colors.accent}`
                        : '0 1px 3px rgba(0,0,0,0.04)',
                      transition: 'all 0.2s ease',
                      transform: isSelected ? 'translateY(-2px)' : 'none',
                    }}
                  >
                    {/* Year Badge */}
                    <div style={{
                      minWidth: 80, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      background: colors.gradient, color: '#fff', padding: '16px 20px',
                      fontWeight: 700,
                    }}>
                      <div style={{ fontSize: 28, lineHeight: 1 }}>{paper.year}</div>
                      <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>Paper {paper.paper_number}</div>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1e293b' }}>
                        {paper.title}
                      </h3>
                      <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                          &#9200; {paper.duration_minutes} min
                        </span>
                        <span style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                          &#9998; {paper.total_marks} marks
                        </span>
                        <span style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                          &#128214; {qCount} questions
                        </span>
                      </div>
                    </div>

                    {/* Arrow */}
                    <div style={{
                      display: 'flex', alignItems: 'center', paddingRight: 16,
                      color: isSelected ? colors.accent : '#cbd5e1',
                      fontSize: 20, transition: 'all 0.2s',
                    }}>
                      &#8250;
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Rules + Start */}
          {selectedPaper && (
            <div style={{ marginTop: 28 }}>
              <div style={{
                background: '#fff', borderRadius: 14, padding: '20px 24px',
                border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: 15, fontWeight: 600, color: '#1e293b' }}>
                  Exam Rules
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                  {[
                    { icon: '&#127758;', text: 'Do not switch tabs or windows' },
                    { icon: '&#128248;', text: 'Keep your face visible in camera' },
                    { icon: '&#128683;', text: 'No copy/paste or right-click' },
                    { icon: '&#9974;', text: 'Stay in fullscreen mode' },
                  ].map((rule, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569' }}>
                      <span dangerouslySetInnerHTML={{ __html: rule.icon }} />
                      <span>{rule.text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <button
                  onClick={() => setShowPreCheck(true)}
                  style={{
                    padding: '14px 48px', fontSize: 17, fontWeight: 600,
                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(37,99,235,0.35)',
                    transition: 'all 0.2s',
                  }}
                >
                  Setup & Start {selectedPaper.title}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Exam Ended Screen ----
  if (status === 'ended') {
    const pct = finalTotal > 0 ? Math.round((finalScore / finalTotal) * 100) : 0;
    const gradeColor = pct >= 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#ef4444';

    return (
      <div style={{ maxWidth: 620, margin: '40px auto', fontFamily: "'Inter', system-ui, sans-serif", padding: 20 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 140, height: 140, borderRadius: '50%', margin: '0 auto 20px',
            background: `conic-gradient(${gradeColor} ${pct}%, #e2e8f0 ${pct}%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
          }}>
            <div style={{
              width: 116, height: 116, borderRadius: '50%', background: '#fff',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 32, fontWeight: 800, color: gradeColor }}>{pct}%</span>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{finalScore}/{finalTotal} correct</span>
            </div>
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#1e293b' }}>Exam Submitted</h1>
          {sessionId && <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>Session: {sessionId}</p>}
        </div>

        {/* Per-question breakdown */}
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 8px 0' }}>Question Breakdown</h3>
          {scoreDetails.map((d, i) => (
            <div key={d.qid} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              marginBottom: 4, borderRadius: 6,
              background: d.yours === d.correct ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${d.yours === d.correct ? '#bbf7d0' : '#fecaca'}`,
            }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 12,
                fontWeight: 700, flexShrink: 0,
                background: d.yours === d.correct ? '#16a34a' : '#ef4444',
                color: '#fff',
              }}>
                {d.yours === d.correct ? '✓' : '✗'}
              </span>
              <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Q{i + 1}: <MathText text={d.text} />
              </span>
              <span style={{ fontSize: 11, color: '#6b7280', flexShrink: 0 }}>
                {d.yours !== null ? `You: ${String.fromCharCode(65 + d.yours)}` : 'Skipped'}
                {' · '}
                Answer: {String.fromCharCode(65 + d.correct)}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={() => {
            const qs = selectedPaper!.questions as Question[];
            const details = qs.map((q, i) => ({
              qid: q.id,
              questionLabel: `Q${i + 1}`,
              text: q.text,
              timeMs: finalQuestionTimes[q.id] || 0,
              correctAnswer: q.answer,
              yourAnswer: answers[q.id] ?? null,
              isCorrect: answers[q.id] === q.answer,
            }));

            generateExamReport({
              paperTitle: selectedPaper!.title,
              paperDuration: selectedPaper!.duration_minutes,
              completedAt: new Date(),
              totalQuestions: qs.length,
              score: finalScore,
              maxScore: finalTotal,
              questionDetails: details,
            });
          }}
          style={{
            width: '100%', padding: '12px', marginBottom: 10,
            background: 'linear-gradient(135deg, #059669, #047857)', color: '#fff',
            border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 15,
            fontWeight: 600, boxShadow: '0 2px 10px rgba(5,150,105,0.3)',
            transition: 'all 0.2s',
          }}
        >
          Download Report (PDF)
        </button>

        <button
          onClick={() => { setExamStarted(false); resetSession(); setSelectedPaper(null); }}
          style={{
            width: '100%', padding: '12px', background: '#fff', color: '#475569',
            border: '1px solid #e2e8f0', borderRadius: 12, cursor: 'pointer', fontSize: 15,
            fontWeight: 500, transition: 'all 0.2s',
          }}
        >
          Back to Papers
        </button>

        <ViolationLog />
      </div>
    );
  }

  // ---- Active Exam Screen ----
  const q = questions[currentQ];
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const answeredCount = Object.keys(answers).length;
  const progressPct = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", userSelect: 'none', width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box', background: '#f1f5f9' }}>
      <TabSwitchDetector />
      <ViolationAlert />

      {/* ── Dark Top Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 24px', background: '#0f172a', color: '#fff', gap: 20, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#f1f5f9' }}>{selectedPaper?.title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Q{currentQ + 1} of {questions.length}
            </span>
            <span style={{ color: '#334155', fontSize: 11 }}>|</span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              {answeredCount} answered
            </span>
            {/* Mini progress bar */}
            <div style={{ flex: 1, maxWidth: 120, height: 3, background: '#334155', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: '#22c55e', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          </div>
        </div>

        <div style={{
          fontSize: 34, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: timeLeft < 60 ? '#f87171' : '#f8fafc', letterSpacing: 2,
          background: timeLeft < 60 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.08)',
          padding: '6px 24px', borderRadius: 10, minWidth: 120, textAlign: 'center',
          transition: 'color 0.5s, background 0.5s',
          border: `1px solid ${timeLeft < 60 ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`,
        }}>
          {minutes}:{seconds.toString().padStart(2, '0')}
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left: Question + Options */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Scrollable question area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: '#f1f5f9' }}>
            {q && (
              <div style={{
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
                overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              }}>
                {q.image_url ? (
                  <>
                    <img
                      src={q.image_url}
                      alt={`Question ${currentQ + 1}`}
                      style={{ width: '100%', display: 'block' }}
                    />
                    <div style={{ padding: '16px 24px', display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', borderTop: '1px solid #e5e7eb' }}>
                      {q.options.map((_opt, i) => {
                        const letter = String.fromCharCode(65 + i);
                        const isSel = selected === i;
                        return (
                          <button
                            key={i}
                            onClick={() => selectAnswer(q.id, i)}
                            style={{
                              width: 52, height: 52, borderRadius: '50%',
                              border: isSel ? '3px solid #2563eb' : '2px solid #d1d5db',
                              background: isSel ? '#2563eb' : '#fff',
                              color: isSel ? '#fff' : '#374151',
                              cursor: 'pointer', fontSize: 20, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.15s',
                            }}
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '20px 24px' }}>
                    <p style={{ fontSize: 18, fontWeight: 500, margin: '0 0 20px 0', lineHeight: 1.7 }}>
                      <MathText text={q.text} />
                    </p>
                    {q.options.map((opt, i) => (
                      <label
                        key={i}
                        style={{
                          display: 'flex', alignItems: 'center', padding: '12px 16px', marginBottom: 8,
                          background: selected === i ? '#dbeafe' : '#fff',
                          border: `2px solid ${selected === i ? '#2563eb' : '#e5e7eb'}`,
                          borderRadius: 8, cursor: 'pointer', fontSize: 15,
                          transition: 'all 0.15s',
                        }}
                      >
                        <input
                          type="radio" name={`q-${q.id}`}
                          checked={selected === i}
                          onChange={() => selectAnswer(q.id, i)}
                          style={{ marginRight: 10, width: 16, height: 16, accentColor: '#2563eb' }}
                        />
                        <span style={{ flex: 1 }}><MathText text={opt} /></span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fixed Bottom Nav Bar */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 24px', background: '#fff', flexShrink: 0,
            borderTop: '1px solid #e2e8f0', gap: 16,
          }}>
            <button
              disabled={currentQ === 0}
              onClick={() => {
                accumulateCurrentQTime();
                setCurrentQ((c) => c - 1);
                setSelected(answers[questions[currentQ - 1]?.id] ?? null);
                activeQStartRef.current = Date.now();
              }}
              style={{
                padding: '10px 22px', border: '1px solid #e2e8f0', borderRadius: 10,
                background: '#fff', cursor: currentQ === 0 ? 'default' : 'pointer',
                opacity: currentQ === 0 ? 0.35 : 1, fontSize: 14, fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 6, color: '#334155',
                transition: 'all 0.15s',
              }}
            >
              ← Previous
            </button>

            {/* Center page indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#64748b' }}>
              {Array.from({ length: Math.min(questions.length, 20) }).map((_, i) => {
                const start = Math.max(0, Math.min(currentQ - 3, questions.length - 7));
                const end = Math.min(questions.length, start + 7);
                if (questions.length <= 7) {
                  const isAnswered = answers[questions[i]?.id] !== undefined;
                  return (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: i === currentQ ? '#3b82f6' : isAnswered ? '#22c55e' : '#cbd5e1',
                      transition: 'all 0.2s',
                    }} />
                  );
                }
                return null;
              })}
              <span style={{ fontWeight: 500, fontSize: 12 }}>{currentQ + 1}/{questions.length}</span>
            </div>

            {currentQ < questions.length - 1 ? (
              <button
                onClick={() => {
                  accumulateCurrentQTime();
                  setCurrentQ((c) => c + 1);
                  setSelected(answers[questions[currentQ + 1]?.id] ?? null);
                  activeQStartRef.current = Date.now();
                }}
                style={{
                  padding: '10px 28px', background: '#3b82f6', color: '#fff',
                  border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 6,
                  boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
                  transition: 'all 0.15s',
                }}
              >
                Next →
              </button>
            ) : (
              <button
                onClick={finishExam}
                style={{
                  padding: '10px 28px', background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff',
                  border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: 14,
                  boxShadow: '0 2px 10px rgba(34,197,94,0.35)',
                  transition: 'all 0.15s',
                }}
              >
                Submit Exam
              </button>
            )}
          </div>
        </div>

        {/* Right Panel: Webcam + Question Navigator */}
        <div style={{
          flex: '0 0 240px', width: 240,
          display: 'flex', flexDirection: 'column', gap: 12,
          padding: '14px 14px 14px 0',
          background: '#f8fafc',
          overflowY: 'auto',
        }}>
          {/* Webcam */}
          <div style={{
            background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
            padding: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}>
            <p style={{ margin: '0 0 8px 0', fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>
              Camera
            </p>
            <WebcamCapture />
          </div>

          {/* Question Navigator */}
          <div style={{
            background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
            padding: 14, boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}>
            <p style={{ margin: '0 0 10px 0', fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' }}>
              Questions
            </p>
            {/* Legend */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 10, fontSize: 10, color: '#94a3b8' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} /> Answered
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#cbd5e1', display: 'inline-block' }} /> Pending
              </span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 5,
            }}>
              {questions.map((_, i) => {
                const isAnswered = answers[questions[i]?.id] !== undefined;
                const isCurrent = currentQ === i;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (i !== currentQ) {
                        accumulateCurrentQTime();
                        setCurrentQ(i);
                        setSelected(answers[questions[i]?.id] ?? null);
                        activeQStartRef.current = Date.now();
                      }
                    }}
                    style={{
                      aspectRatio: '1',
                      border: isCurrent ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                      borderRadius: 8,
                      background: isCurrent ? '#eff6ff' : isAnswered ? '#f0fdf4' : '#fff',
                      cursor: 'pointer', fontSize: 12, fontWeight: isCurrent ? 700 : 500,
                      color: isCurrent ? '#3b82f6' : '#475569',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                      position: 'relative' as const,
                    }}
                  >
                    {i + 1}
                    {isAnswered && !isCurrent && (
                      <span style={{
                        position: 'absolute', bottom: 2, right: 3,
                        width: 4, height: 4, borderRadius: '50%', background: '#22c55e',
                      }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Violation Log (in right panel) */}
          <ViolationLog />
        </div>
      </div>
    </div>
  );
}

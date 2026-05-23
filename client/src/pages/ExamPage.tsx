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
  if (!examStarted) {
    return (
      <div style={{ maxWidth: 700, margin: '60px auto', fontFamily: 'system-ui, sans-serif', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', marginRight: 12, alignSelf: 'center' }}>
            {user?.email}
          </span>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ padding: '4px 12px', border: '1px solid #d1d5db', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#6b7280' }}
          >
            Sign Out
          </button>
        </div>
        <h1 style={{ textAlign: 'center', marginBottom: 8 }}>TMUA Practice Papers</h1>
        <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: 32 }}>
          Select a paper to begin. Your exam will be proctored.
        </p>

        {fetchState === 'error' ? (
          <div style={{ textAlign: 'center', padding: 40, background: '#fef2f2', borderRadius: 12, border: '1px solid #fecaca' }}>
            <p style={{ color: '#dc2626', marginBottom: 8 }}>Failed to load papers</p>
            <button onClick={retryFetch} style={{ padding: '6px 20px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : fetchState === 'loading' && papers.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#9ca3af' }}>Loading papers...</p>
        ) : papers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, background: '#f9fafb', borderRadius: 12 }}>
            <p style={{ color: '#6b7280' }}>No papers available yet.</p>
            <p style={{ fontSize: 13, color: '#9ca3af' }}>
              Run the SQL schema in your Supabase SQL Editor to seed sample papers.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {papers.map((paper) => (
              <div
                key={paper.id}
                onClick={() => setSelectedPaper(paper)}
                style={{
                  padding: 16,
                  border: `2px solid ${selectedPaper?.id === paper.id ? '#2563eb' : '#e5e7eb'}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: selectedPaper?.id === paper.id ? '#eff6ff' : '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16 }}>{paper.title}</h3>
                    <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
                      Paper {paper.paper_number} &middot; {paper.sitting} {paper.year} &middot;{' '}
                      {paper.duration_minutes} min &middot; {paper.total_marks} marks
                    </p>
                  </div>
                  <span style={{ fontSize: 13, color: '#2563eb', fontWeight: 600 }}>
                    {(paper.questions as Question[]).length} questions
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedPaper && (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <ul style={{ textAlign: 'left', display: 'inline-block', color: '#6b7280', fontSize: 14 }}>
              <li>Do not switch tabs or windows</li>
              <li>Keep your face visible in the camera</li>
              <li>No copy/paste or right-click</li>
              <li>Stay in fullscreen mode</li>
            </ul>
            <br />
            <button
              onClick={() => setShowPreCheck(true)}
              style={{ marginTop: 12, padding: '12px 40px', fontSize: 18, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
            >
              Setup & Start {selectedPaper.title}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---- Exam Ended Screen ----
  if (status === 'ended') {
    const pct = finalTotal > 0 ? Math.round((finalScore / finalTotal) * 100) : 0;
    const gradeColor = pct >= 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#ef4444';

    return (
      <div style={{ maxWidth: 600, margin: '40px auto', fontFamily: 'system-ui, sans-serif', padding: 20 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 120, height: 120, borderRadius: '50%', margin: '0 auto 16px',
            background: `conic-gradient(${gradeColor} ${pct}%, #e5e7eb ${pct}%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 100, height: 100, borderRadius: '50%', background: '#fff',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: gradeColor }}>{pct}%</span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{finalScore}/{finalTotal} correct</span>
            </div>
          </div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Exam Submitted</h1>
          {sessionId && <p style={{ color: '#9ca3af', fontSize: 12 }}>Session: {sessionId}</p>}
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
          style={{ width: '100%', padding: '10px', marginBottom: 12, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15 }}
        >
          Download Report (PDF)
        </button>

        <button
          onClick={() => { setExamStarted(false); resetSession(); setSelectedPaper(null); }}
          style={{ width: '100%', padding: '10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15 }}
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

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', userSelect: 'none', width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
      <TabSwitchDetector />
      <ViolationAlert />

      {/* ── Top Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 24px', borderBottom: '1px solid #e5e7eb', background: '#fff', gap: 20, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedPaper?.title}</h2>
          <p style={{ margin: '1px 0 0', color: '#6b7280', fontSize: 12 }}>
            Q{currentQ + 1} of {questions.length} &middot; {answeredCount} answered
          </p>
        </div>

        <div style={{
          fontSize: 32, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: timeLeft < 60 ? '#ef4444' : '#111', letterSpacing: 1,
          background: '#f9fafb', padding: '4px 20px', borderRadius: 10,
        }}>
          {minutes}:{seconds.toString().padStart(2, '0')}
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left: Question + Options */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Scrollable question area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {q && (
              <div style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
                overflow: 'hidden',
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
            padding: '12px 24px', borderTop: '1px solid #e5e7eb', background: '#fff',
            flexShrink: 0,
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
                padding: '10px 20px', border: '1px solid #d1d5db', borderRadius: 8,
                background: '#fff', cursor: currentQ === 0 ? 'default' : 'pointer',
                opacity: currentQ === 0 ? 0.4 : 1, fontSize: 14, fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              ← Previous
            </button>

            <span style={{ fontSize: 13, color: '#9ca3af' }}>
              {currentQ + 1} / {questions.length}
            </span>

            {currentQ < questions.length - 1 ? (
              <button
                onClick={() => {
                  accumulateCurrentQTime();
                  setCurrentQ((c) => c + 1);
                  setSelected(answers[questions[currentQ + 1]?.id] ?? null);
                  activeQStartRef.current = Date.now();
                }}
                style={{
                  padding: '10px 28px', background: '#2563eb', color: '#fff',
                  border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                Next →
              </button>
            ) : (
              <button
                onClick={finishExam}
                style={{
                  padding: '10px 28px', background: '#16a34a', color: '#fff',
                  border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14,
                }}
              >
                Submit Exam
              </button>
            )}
          </div>
        </div>

        {/* Right Panel: Webcam + Question Navigator */}
        <div style={{
          flex: '0 0 230px', width: 230,
          display: 'flex', flexDirection: 'column', gap: 12,
          padding: '16px 16px 16px 0',
          borderLeft: '1px solid #e5e7eb', background: '#fafafa',
          overflowY: 'auto',
        }}>
          {/* Webcam */}
          <div style={{
            background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
            padding: 8,
          }}>
            <p style={{ margin: '0 0 6px 0', fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' }}>
              Camera
            </p>
            <WebcamCapture />
          </div>

          {/* Question Navigator */}
          <div style={{
            background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb',
            padding: 12,
          }}>
            <p style={{ margin: '0 0 10px 0', fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' }}>
              Questions
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 6,
            }}>
              {questions.map((_, i) => (
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
                    border: currentQ === i ? '2px solid #2563eb' : '1px solid #e5e7eb',
                    borderRadius: 6,
                    background: answers[questions[i]?.id] !== undefined
                      ? (currentQ === i ? '#dbeafe' : '#eff6ff')
                      : (currentQ === i ? '#fff' : '#fff'),
                    cursor: 'pointer', fontSize: 14, fontWeight: currentQ === i ? 700 : 500,
                    color: currentQ === i ? '#2563eb' : '#374151',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>

          {/* Violation Log (in right panel) */}
          <ViolationLog />
        </div>
      </div>
    </div>
  );
}

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
  const [reviewQuestionIndex, setReviewQuestionIndex] = useState<number | null>(null);
  const [showEndTestDialog, setShowEndTestDialog] = useState(false);
  const [flaggedQuestions, setFlaggedQuestions] = useState<Set<string>>(new Set());
  const [showExamConfirm, setShowExamConfirm] = useState(false);
  const [resultsView, setResultsView] = useState<'table' | 'score'>('table');
  const [showNavigator, setShowNavigator] = useState(false);

  const toggleFlag = useCallback((qId: string) => {
    setFlaggedQuestions(prev => {
      const next = new Set(prev);
      if (next.has(qId)) next.delete(qId);
      else next.add(qId);
      return next;
    });
  }, []);

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
    setResultsView('table');

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
          setShowExamConfirm(true);
        }}
        onBack={() => setShowPreCheck(false)}
      />
    );
  }

  // ---- Exam Confirmation Page (after PreExamCheck) ----
  if (showExamConfirm && !examStarted && selectedPaper) {
    const qCount = (selectedPaper.questions as Question[]).length;
    return (
      <div style={{
        fontFamily: "'Times New Roman', Times, serif",
        minHeight: '100vh', background: '#ffffff',
      }}>
        {/* Blue Top Bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 32px', height: 48,
          background: '#306ca0',
        }}>
          <span style={{
            fontSize: 18, fontWeight: 400, color: '#ffffff',
            fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '0.3px',
          }}>
            Test of Mathematics for University Admission
          </span>
        </div>

        {/* Content */}
        <div style={{ maxWidth: 700, margin: '0 auto', padding: '48px 20px' }}>
          <h1 style={{
            fontSize: 22, fontWeight: 400, color: '#333',
            fontFamily: "'Times New Roman', Times, serif",
            textAlign: 'center', marginBottom: 32,
          }}>
            Examination Confirmation
          </h1>

          <div style={{
            background: '#fafafa', borderRadius: 8,
            border: '1px solid #e0e0e0', padding: '28px 32px',
            marginBottom: 28,
          }}>
            <div style={{ marginBottom: 20 }}>
              <h3 style={{
                margin: '0 0 4px 0', fontSize: 16, fontWeight: 600, color: '#333',
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                {selectedPaper.title}
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
                {selectedPaper.year} — Paper {selectedPaper.paper_number}
              </p>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              gap: '12px 24px', marginBottom: 20,
            }}>
              <div>
                <span style={{ fontSize: 12, color: '#888' }}>Duration</span>
                <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: '#333' }}>
                  {selectedPaper.duration_minutes} minutes
                </p>
              </div>
              <div>
                <span style={{ fontSize: 12, color: '#888' }}>Total Questions</span>
                <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: '#333' }}>
                  {qCount}
                </p>
              </div>
              <div>
                <span style={{ fontSize: 12, color: '#888' }}>Total Marks</span>
                <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: '#333' }}>
                  {selectedPaper.total_marks}
                </p>
              </div>
              <div>
                <span style={{ fontSize: 12, color: '#888' }}>Topics</span>
                <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, color: '#333' }}>
                  {selectedPaper.topics?.join(', ') || 'Mathematics'}
                </p>
              </div>
            </div>

            <div style={{
              background: '#fff', borderRadius: 6, border: '1px solid #e0e0e0',
              padding: '16px 20px',
            }}>
              <h4 style={{
                margin: '0 0 10px 0', fontSize: 13, fontWeight: 600, color: '#333',
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                Important Information
              </h4>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#555', lineHeight: 1.8 }}>
                <li>Once you begin, the timer will start immediately</li>
                <li>You must remain in fullscreen mode for the entire duration</li>
                <li>Your webcam and microphone must remain active</li>
                <li>Do not switch tabs, windows, or applications</li>
                <li>You may flag questions to review later</li>
                <li>Submit your exam when you have answered all questions</li>
              </ul>
            </div>
          </div>

          <div style={{ textAlign: 'center', display: 'flex', gap: 16, justifyContent: 'center' }}>
            <button
              onClick={() => setShowExamConfirm(false)}
              style={{
                padding: '12px 40px', fontSize: 15, fontWeight: 400,
                background: '#fff', color: '#333',
                border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer',
                fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              Back
            </button>
            <button
              onClick={() => {
                setShowExamConfirm(false);
                beginExam();
              }}
              style={{
                padding: '12px 40px', fontSize: 15, fontWeight: 400,
                background: '#306ca0', color: '#fff',
                border: 'none', borderRadius: 4, cursor: 'pointer',
                fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              Confirm & Start Exam
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Paper Selection Screen ----
  const paperColor = (paper: Paper) => {
    if (paper.paper_number === 1) return { bg: '#eff6ff', accent: '#306ca0', badgeBg: '#306ca0' };
    return { bg: '#f0fdf4', accent: '#306ca0', badgeBg: '#306ca0' };
  };

  if (!examStarted) {
    return (
      <div style={{ minHeight: '100vh', fontFamily: "'Times New Roman', Times, serif", background: '#ffffff' }}>
        {/* Blue Top Bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 32px', height: 48,
          background: '#306ca0',
        }}>
          <span style={{
            fontSize: 18, fontWeight: 400, color: '#ffffff',
            fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '0.3px',
          }}>
            Test of Mathematics for University Admission
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{user?.email}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              style={{
                padding: '6px 16px', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4,
                background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#fff',
                fontWeight: 400, fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Content area */}
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px 60px' }}>
          <h1 style={{
            margin: '0 0 8px 0', fontSize: 24, fontWeight: 400, color: '#333',
            fontFamily: "'Times New Roman', Times, serif",
            textAlign: 'center',
          }}>
            TMUA Practice Papers
          </h1>
          <p style={{
            margin: '0 0 32px 0', color: '#888', fontSize: 14, textAlign: 'center',
            fontFamily: "'Times New Roman', Times, serif",
          }}>
            Select a paper to begin your proctored exam session
          </p>

          {fetchState === 'error' ? (
            <div style={{
              textAlign: 'center', padding: 40, borderRadius: 8,
              background: '#fef2f2', border: '1px solid #fecaca',
            }}>
              <p style={{ color: '#dc2626', marginBottom: 8 }}>Failed to load papers</p>
              <button onClick={retryFetch} style={{
                padding: '8px 24px', background: '#dc2626', color: '#fff',
                border: 'none', borderRadius: 4, cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
              }}>Retry</button>
            </div>
          ) : fetchState === 'loading' && papers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#888' }}>
              <div style={{
                width: 48, height: 48, margin: '0 auto 16px',
                border: '3px solid #e0e0e0', borderTopColor: '#306ca0',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              }} />
              <p style={{ fontSize: 14 }}>Loading papers...</p>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : papers.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: 60, borderRadius: 8,
              background: '#fafafa', border: '1px solid #e0e0e0',
            }}>
              <p style={{ color: '#888', fontSize: 14 }}>No papers available yet.</p>
              <p style={{ fontSize: 13, color: '#aaa' }}>
                Run the SQL schema in your Supabase SQL Editor to seed sample papers.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {papers.map((paper) => {
                const colors = paperColor(paper);
                const isSelected = selectedPaper?.id === paper.id;
                const qCount = (paper.questions as Question[]).length;
                return (
                  <div
                    key={paper.id}
                    onClick={() => setSelectedPaper(paper)}
                    style={{
                      display: 'flex', alignItems: 'stretch', borderRadius: 8,
                      cursor: 'pointer', overflow: 'hidden',
                      background: isSelected ? '#eff6ff' : '#fff',
                      border: `1.5px solid ${isSelected ? colors.accent : '#e0e0e0'}`,
                      boxShadow: 'none',
                      transition: 'all 0.2s ease',
                      transform: isSelected ? 'translateY(-1px)' : 'none',
                    }}
                  >
                    {/* Year Badge */}
                    <div style={{
                      minWidth: 84, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      background: colors.accent, color: '#fff', padding: '18px 22px',
                      fontWeight: 700,
                    }}>
                      <div style={{ fontSize: 28, lineHeight: 1 }}>{paper.year}</div>
                      <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>Paper {paper.paper_number}</div>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#333', fontFamily: "'Times New Roman', Times, serif" }}>
                        {paper.title}
                      </h3>
                      <div style={{ display: 'flex', gap: 20, marginTop: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          {paper.duration_minutes} min
                        </span>
                        <span style={{ fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                          {paper.total_marks} marks
                        </span>
                        <span style={{ fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          {qCount} questions
                        </span>
                      </div>
                    </div>

                    {/* Arrow */}
                    <div style={{
                      display: 'flex', alignItems: 'center', paddingRight: 16,
                      color: isSelected ? colors.accent : '#ccc',
                      fontSize: 22, transition: 'all 0.2s',
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
                background: '#fafafa', borderRadius: 8,
                padding: '22px 28px',
                border: '1px solid #e0e0e0',
              }}>
                <h3 style={{ margin: '0 0 14px 0', fontSize: 15, fontWeight: 600, color: '#333', fontFamily: "'Times New Roman', Times, serif" }}>
                  Exam Rules
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 28px' }}>
                  {[
                    { text: 'Do not switch tabs or windows' },
                    { text: 'Keep your face visible in camera' },
                    { text: 'No copy/paste or right-click' },
                    { text: 'Stay in fullscreen mode' },
                  ].map((rule, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#666' }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', background: '#306ca0', flexShrink: 0,
                      }} />
                      <span>{rule.text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'center', marginTop: 22 }}>
                <button
                  onClick={() => setShowPreCheck(true)}
                  style={{
                    padding: '12px 48px', fontSize: 16, fontWeight: 400,
                    background: '#306ca0',
                    color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
                    fontFamily: "'Times New Roman', Times, serif",
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
    // Review mode: show a specific question read-only
    if (reviewQuestionIndex !== null && selectedPaper) {
      const qs = selectedPaper.questions as Question[];
      const rq = qs[reviewQuestionIndex];
      const userAns = answers[rq?.id] ?? null;
      const isCorrect = userAns === rq?.answer;
      const letter = userAns !== null ? String.fromCharCode(65 + userAns) : null;
      const correctLetter = String.fromCharCode(65 + rq?.answer);

      return (
        <div style={{
          fontFamily: "'Times New Roman', Times, serif",
          userSelect: 'none', width: '100vw', height: '100vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: '#ffffff',
        }}>
          {/* Blue Top Bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 32px', height: 48, flexShrink: 0,
            background: '#306ca0',
          }}>
            <span style={{
              fontSize: 18, fontWeight: 400, color: '#ffffff',
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '0.3px',
            }}>
              Test of Mathematics for University Admission
            </span>
            <span style={{
              fontSize: 18, fontWeight: 400, color: '#ffffff',
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              Review Mode
            </span>
          </div>

          {/* Review content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: '#f5f5f5' }}>
            <div style={{
              maxWidth: 800, margin: '0 auto', background: '#fff',
              borderRadius: 8, border: '1px solid #e0e0e0',
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', background: '#fafafa',
                borderBottom: '1px solid #e0e0e0',
              }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#333', fontFamily: "'Times New Roman', Times, serif" }}>
                  Question {reviewQuestionIndex + 1}
                </span>
                <span style={{
                  fontSize: 13, fontWeight: 600,
                  color: isCorrect ? '#16a34a' : '#dc2626',
                  padding: '3px 12px', borderRadius: 4,
                  background: isCorrect ? '#dcfce7' : '#fef2f2',
                  fontFamily: "'Times New Roman', Times, serif",
                }}>
                  {isCorrect ? 'Correct' : 'Incorrect'}
                </span>
              </div>

              {rq.image_url ? (
                <>
                  <img src={rq.image_url} alt={`Question ${reviewQuestionIndex + 1}`}
                    style={{ width: '100%', display: 'block' }} />
                  <div style={{
                    padding: '18px 20px', display: 'flex', gap: 14,
                    justifyContent: 'center', flexWrap: 'wrap',
                    borderTop: '1px solid #e0e0e0',
                  }}>
                    {rq.options.map((_opt: string, i: number) => {
                      const optLetter = String.fromCharCode(65 + i);
                      const isUserSel = userAns === i;
                      const isCorrectAns = rq.answer === i;
                      let bg = '#fff';
                      let border = '2px solid #d1d5db';
                      let color = '#475569';
                      if (isCorrectAns) { bg = '#dcfce7'; border = '2px solid #16a34a'; color = '#16a34a'; }
                      if (isUserSel && !isCorrectAns) { bg = '#fef2f2'; border = '2px solid #dc2626'; color = '#dc2626'; }
                      return (
                        <div key={i} style={{
                          width: 56, height: 56, borderRadius: '50%',
                          border, background: bg, color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 22, fontWeight: 700,
                        }}>
                          {optLetter}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div style={{ padding: '24px 28px' }}>
                  <p style={{
                    fontSize: 17, fontWeight: 500, margin: '0 0 24px 0',
                    lineHeight: 1.75, color: '#1e293b',
                  }}>
                    <MathText text={rq.text} />
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {rq.options.map((opt: string, i: number) => {
                      const optLetter = String.fromCharCode(65 + i);
                      const isUserSel = userAns === i;
                      const isCorrectAns = rq.answer === i;
                      let bg = '#fff';
                      let border = '2px solid #e5e7eb';
                      let labelColor = '#64748b';
                      let textColor = '#374151';
                      if (isCorrectAns) { bg = '#dcfce7'; border = '2px solid #16a34a'; labelColor = '#16a34a'; textColor = '#16a34a'; }
                      if (isUserSel && !isCorrectAns) { bg = '#fef2f2'; border = '2px solid #dc2626'; labelColor = '#dc2626'; textColor = '#dc2626'; }
                      return (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: '14px 18px', background: bg,
                          border, borderRadius: 8,
                        }}>
                          <span style={{
                            width: 40, height: 40, borderRadius: '50%',
                            border: `2px solid ${isUserSel || isCorrectAns ? (isCorrectAns ? '#16a34a' : '#dc2626') : '#d1d5db'}`,
                            background: isUserSel || isCorrectAns ? (isCorrectAns ? '#16a34a' : '#dc2626') : '#f8fafc',
                            color: (isUserSel || isCorrectAns) ? '#fff' : '#64748b',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 16, fontWeight: 700, flexShrink: 0,
                          }}>
                            {optLetter}
                          </span>
                          <span style={{ flex: 1, fontSize: 15, color: textColor, lineHeight: 1.5 }}>
                            <MathText text={opt} />
                          </span>
                          {isCorrectAns && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>Correct Answer</span>}
                          {isUserSel && !isCorrectAns && <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Your Answer</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Your answer + correct answer summary */}
            <div style={{
              maxWidth: 800, margin: '16px auto 0', display: 'flex', gap: 16,
              justifyContent: 'center', fontSize: 14, color: '#555',
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              <span>Your answer: <strong style={{ color: isCorrect ? '#16a34a' : '#dc2626' }}>{letter ?? 'Not answered'}</strong></span>
              <span>Correct answer: <strong style={{ color: '#16a34a' }}>{correctLetter}</strong></span>
            </div>
          </div>

          {/* Bottom nav */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 24px', flexShrink: 0,
            background: '#fff', borderTop: '1px solid #e0e0e0',
          }}>
            <button
              onClick={() => setReviewQuestionIndex(null)}
              style={{
                padding: '8px 28px', borderRadius: 4,
                border: '1px solid #ccc', background: '#fff',
                cursor: 'pointer', fontSize: 15, fontWeight: 400,
                color: '#333', fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              Back to Results
            </button>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                disabled={reviewQuestionIndex === 0}
                onClick={() => setReviewQuestionIndex((i) => (i ?? 0) - 1)}
                style={{
                  padding: '8px 28px', borderRadius: 4,
                  border: '1px solid #ccc', background: '#fff',
                  cursor: reviewQuestionIndex === 0 ? 'default' : 'pointer',
                  opacity: reviewQuestionIndex === 0 ? 0.4 : 1,
                  fontSize: 15, fontWeight: 400, color: '#333',
                  fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                Previous
              </button>
              <button
                disabled={reviewQuestionIndex === qs.length - 1}
                onClick={() => setReviewQuestionIndex((i) => (i ?? 0) + 1)}
                style={{
                  padding: '8px 28px', borderRadius: 4,
                  background: '#306ca0', border: 'none',
                  cursor: reviewQuestionIndex === qs.length - 1 ? 'default' : 'pointer',
                  opacity: reviewQuestionIndex === qs.length - 1 ? 0.6 : 1,
                  fontSize: 15, fontWeight: 400, color: '#fff',
                  fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Results Table (截屏4): Page | Title | Status | Flag | Review
    if (resultsView === 'table') {
      const qs = (selectedPaper?.questions as Question[]) || [];
      const answeredCount = qs.filter((q) => answers[q.id] !== undefined).length;
      const unseenCount = qs.length - answeredCount;

      return (
        <div style={{
          fontFamily: "'Times New Roman', Times, serif",
          userSelect: 'none', width: '100vw', height: '100vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: '#ffffff',
        }}>
          {/* Blue Top Bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 24px', height: 48, flexShrink: 0,
            background: '#306ca0',
          }}>
            <span style={{
              fontSize: 18, fontWeight: 400, color: '#ffffff',
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '0.3px',
            }}>
              Test of Mathematics for University Admission
            </span>
            <span style={{
              fontSize: 15, fontWeight: 400, color: '#ffffff',
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              Results
            </span>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: '#f5f5f5' }}>
            <div style={{ maxWidth: 960, margin: '0 auto' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 20,
              }}>
                <h2 style={{
                  margin: 0, fontSize: 20, fontWeight: 400, color: '#333',
                  fontFamily: "'Times New Roman', Times, serif",
                }}>
                  Question Status
                </h2>
                <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#666', fontFamily: "'Times New Roman', Times, serif" }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#16a34a' }} />
                    Completed ({answeredCount})
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#d97706' }} />
                    Unseen ({unseenCount})
                  </span>
                </div>
              </div>

              {/* Table */}
              <div style={{
                background: '#fff', borderRadius: 8,
                border: '1px solid #e0e0e0', overflow: 'hidden',
              }}>
                {/* Header row */}
                <div style={{
                  display: 'flex', alignItems: 'center',
                  padding: '10px 20px', background: '#fafafa',
                  borderBottom: '2px solid #e0e0e0',
                  fontSize: 13, fontWeight: 600, color: '#555',
                  fontFamily: "'Times New Roman', Times, serif",
                }}>
                  <span style={{ width: 60 }}>Page</span>
                  <span style={{ flex: 1 }}>Title</span>
                  <span style={{ width: 100, textAlign: 'center' }}>Status</span>
                  <span style={{ width: 60, textAlign: 'center' }}>Flag</span>
                  <span style={{ width: 90, textAlign: 'right' }}>Review</span>
                </div>

                {qs.map((q, i) => {
                  const isAnswered = answers[q.id] !== undefined;
                  const isFlagged = flaggedQuestions.has(q.id);
                  return (
                    <div key={q.id} style={{
                      display: 'flex', alignItems: 'center',
                      padding: '10px 20px',
                      borderBottom: i < qs.length - 1 ? '1px solid #f0f0f0' : 'none',
                      fontSize: 14, fontFamily: "'Times New Roman', Times, serif",
                    }}>
                      <span style={{ width: 60, fontWeight: 600, color: '#333' }}>
                        {i + 1}
                      </span>
                      <span style={{
                        flex: 1, color: '#555', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {q.text?.replace(/\$[^$]+\$/g, '').substring(0, 60) || `Question ${i + 1}`}
                      </span>
                      <span style={{
                        width: 100, textAlign: 'center', fontWeight: 600,
                        color: isAnswered ? '#16a34a' : '#d97706',
                      }}>
                        {isAnswered ? 'Completed' : 'Unseen'}
                      </span>
                      <span style={{ width: 60, textAlign: 'center' }}>
                        {isFlagged && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="#d97706" stroke="#d97706" strokeWidth="2">
                            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                            <line x1="4" y1="22" x2="4" y2="15"/>
                          </svg>
                        )}
                      </span>
                      <span style={{ width: 90, textAlign: 'right' }}>
                        <button
                          onClick={() => setReviewQuestionIndex(i)}
                          style={{
                            padding: '5px 16px', borderRadius: 4,
                            background: '#306ca0', border: 'none',
                            cursor: 'pointer', fontSize: 12, fontWeight: 400,
                            color: '#fff', fontFamily: "'Times New Roman', Times, serif",
                          }}
                        >
                          Review
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Submit button */}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
                <button
                  onClick={() => setResultsView('score')}
                  style={{
                    padding: '10px 40px', borderRadius: 4,
                    background: '#306ca0', border: 'none',
                    cursor: 'pointer', fontSize: 15, fontWeight: 400,
                    color: '#fff', fontFamily: "'Times New Roman', Times, serif",
                  }}
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Final Score Page
    {
      const pct = finalTotal > 0 ? Math.round((finalScore / finalTotal) * 100) : 0;
      const gradeColor = pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
      const gradeBg = pct >= 80 ? '#dcfce7' : pct >= 50 ? '#fef3c7' : '#fef2f2';
      const gradeLabel = pct >= 80 ? 'Excellent' : pct >= 50 ? 'Good Effort' : 'Keep Practicing';

      return (
        <div style={{
          fontFamily: "'Times New Roman', Times, serif",
          userSelect: 'none', width: '100vw', height: '100vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: '#ffffff',
        }}>
          {/* Blue Top Bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 24px', height: 48, flexShrink: 0,
            background: '#306ca0',
          }}>
            <span style={{
              fontSize: 18, fontWeight: 400, color: '#ffffff',
              fontFamily: "'Times New Roman', Times, serif",
              letterSpacing: '0.3px',
            }}>
              Test of Mathematics for University Admission
            </span>
            <span style={{
              fontSize: 15, fontWeight: 400, color: '#ffffff',
              fontFamily: "'Times New Roman', Times, serif",
            }}>
              Results
            </span>
          </div>

          <div style={{
            flex: 1, overflowY: 'auto', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            padding: 20, background: '#f5f5f5',
          }}>
            <div style={{ width: '100%', maxWidth: 640 }}>
              {/* Score Circle */}
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{
                  width: 140, height: 140, borderRadius: '50%', margin: '0 auto 16px',
                  background: gradeColor,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{
                    width: 114, height: 114, borderRadius: '50%',
                    background: '#fff',
                    border: '2px solid #e0e0e0',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 32, fontWeight: 700, color: gradeColor, lineHeight: 1 }}>{pct}%</span>
                    <span style={{ fontSize: 11, color: '#888', fontWeight: 500, marginTop: 2 }}>
                      {finalScore}/{finalTotal} correct
                    </span>
                  </div>
                </div>

                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 400, color: '#333', fontFamily: "'Times New Roman', Times, serif" }}>
                  Exam Submitted
                </h1>
                <span style={{
                  display: 'inline-block', marginTop: 6, padding: '3px 12px',
                  borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: gradeBg, color: gradeColor,
                }}>
                  {gradeLabel}
                </span>
                {sessionId && (
                  <p style={{ color: '#aaa', fontSize: 11, marginTop: 8 }}>
                    Session: {sessionId.slice(0, 8)}...
                  </p>
                )}
              </div>

              {/* Question Breakdown */}
              <div style={{
                background: '#fff', borderRadius: 8,
                border: '1px solid #e0e0e0',
                overflow: 'hidden', marginBottom: 16,
              }}>
                <div style={{
                  padding: '12px 20px', fontSize: 13, fontWeight: 600, color: '#555',
                  background: '#fafafa', borderBottom: '1px solid #e0e0e0',
                  fontFamily: "'Times New Roman', Times, serif",
                }}>
                  Question Breakdown
                </div>
                {scoreDetails.map((d, i) => (
                  <div key={d.qid} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 20px',
                    borderBottom: i < scoreDetails.length - 1 ? '1px solid #f0f0f0' : 'none',
                    cursor: 'pointer',
                  }}
                    onClick={() => setReviewQuestionIndex(i)}
                  >
                    <span style={{
                      width: 24, height: 24, borderRadius: '50%', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 11,
                      fontWeight: 700, flexShrink: 0,
                      background: d.yours === d.correct ? '#dcfce7' : '#fef2f2',
                      color: d.yours === d.correct ? '#16a34a' : '#dc2626',
                    }}>
                      {d.yours === d.correct ? '✓' : '✗'}
                    </span>
                    <span style={{
                      flex: 1, fontSize: 12, color: '#555',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      Q{i + 1}: <MathText text={d.text} />
                    </span>
                    <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0 }}>
                      {d.yours !== null ? `You: ${String.fromCharCode(65 + d.yours)}` : 'Skipped'}
                      {' · '}
                      Ans: {String.fromCharCode(65 + d.correct)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  onClick={() => {
                    const paperQs = selectedPaper!.questions as Question[];
                    const details = paperQs.map((q, i) => ({
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
                      totalQuestions: paperQs.length,
                      score: finalScore,
                      maxScore: finalTotal,
                      questionDetails: details,
                    });
                  }}
                  style={{
                    width: '100%', padding: '12px',
                    background: '#306ca0',
                    color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
                    fontSize: 14, fontWeight: 400,
                    fontFamily: "'Times New Roman', Times, serif",
                  }}
                >
                  Download Report (PDF)
                </button>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => setResultsView('table')}
                    style={{
                      flex: 1, padding: '12px',
                      background: '#fff', color: '#333',
                      border: '1px solid #ccc', borderRadius: 4,
                      cursor: 'pointer', fontSize: 14, fontWeight: 400,
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  >
                    Back to Results
                  </button>
                  <button
                    onClick={() => { setExamStarted(false); resetSession(); setSelectedPaper(null); setReviewQuestionIndex(null); setResultsView('table'); }}
                    style={{
                      flex: 1, padding: '12px',
                      background: '#fff', color: '#333',
                      border: '1px solid #ccc', borderRadius: 4,
                      cursor: 'pointer', fontSize: 14, fontWeight: 400,
                      fontFamily: "'Times New Roman', Times, serif",
                    }}
                  >
                    Back to Papers
                  </button>
                </div>
              </div>

              {/* Violations summary */}
              <div style={{ marginTop: 16 }}>
                <ViolationLog />
              </div>
            </div>
          </div>
        </div>
      );
    }
  }

  // ---- Active Exam Screen ----
  const q = questions[currentQ];
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const answeredCount = Object.keys(answers).length;
  const progressPct = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;
  const isLastQ = currentQ === questions.length - 1;
  const isFirstQ = currentQ === 0;

  return (
    <div style={{
      fontFamily: "'Times New Roman', Times, serif",
      userSelect: 'none', width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: '#ffffff',
    }}>
      <TabSwitchDetector />
      <ViolationAlert />

      {/* ═══════════ Blue Top Bar ═══════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 48, flexShrink: 0,
        background: '#306ca0',
      }}>
        <span style={{
          fontSize: 18, fontWeight: 400, color: '#ffffff',
          fontFamily: "'Times New Roman', Times, serif",
          letterSpacing: '0.3px',
        }}>
          Test of Mathematics for University Admission
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span
            onClick={() => q && toggleFlag(q.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              cursor: 'pointer', userSelect: 'none',
              color: '#ffffff', fontSize: 15, fontWeight: 400,
              fontFamily: "'Times New Roman', Times, serif",
              opacity: q && flaggedQuestions.has(q.id) ? 1 : 0.8,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={q && flaggedQuestions.has(q.id) ? '#fff' : 'none'} stroke="#fff" strokeWidth="2">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
              <line x1="4" y1="22" x2="4" y2="15"/>
            </svg>
            Flag
          </span>
          <span style={{
            fontSize: 15, fontWeight: 400, fontVariantNumeric: 'tabular-nums',
            color: '#ffffff', fontFamily: "'Times New Roman', Times, serif",
          }}>
            Time: {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
        </div>
      </div>

      {/* ═══════════ Main Content ═══════════ */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* ── Center: Question Content ── */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
          background: '#f1f5f9',
        }}>
          {/* Question area */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px 24px',
          }}>
            {q && (
              <div style={{
                background: '#fff', borderRadius: 16,
                border: '1px solid #e2e8f0',
                boxShadow: 'none',
                overflow: 'hidden',
              }}>
                {/* Question header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '14px 20px',
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                }}>
                  <span style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: '#306ca0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0,
                  }}>
                    {currentQ + 1}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                    {selectedPaper?.paper_number === 1 ? 'Paper 1 — Mathematical Thinking' : 'Paper 2 — Mathematical Reasoning'}
                  </span>
                </div>

                {q.image_url ? (
                  <>
                    <img
                      src={q.image_url}
                      alt={`Question ${currentQ + 1}`}
                      style={{ width: '100%', display: 'block' }}
                    />
                    {/* Option buttons for image questions */}
                    <div style={{
                      padding: '18px 20px',
                      display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap',
                      borderTop: '1px solid #e2e8f0',
                    }}>
                      {q.options.map((_opt, i) => {
                        const letter = String.fromCharCode(65 + i);
                        const isSel = selected === i;
                        return (
                          <button
                            key={i}
                            onClick={() => selectAnswer(q.id, i)}
                            style={{
                              width: 56, height: 56, borderRadius: '50%',
                              border: isSel ? '3px solid #306ca0' : '2px solid #d1d5db',
                              background: isSel
                                ? '#306ca0'
                                : '#fff',
                              color: isSel ? '#fff' : '#475569',
                              cursor: 'pointer', fontSize: 22, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.15s ease',
                              boxShadow: 'none',
                              transform: isSel ? 'scale(1.05)' : 'scale(1)',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSel) {
                                e.currentTarget.style.borderColor = '#306ca0';
                                e.currentTarget.style.background = '#eff6ff';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSel) {
                                e.currentTarget.style.borderColor = '#d1d5db';
                                e.currentTarget.style.background = '#fff';
                              }
                            }}
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '24px 28px' }}>
                    <p style={{
                      fontSize: 17, fontWeight: 500, margin: '0 0 24px 0',
                      lineHeight: 1.75, color: '#1e293b',
                    }}>
                      <MathText text={q.text} />
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {q.options.map((opt, i) => {
                        const letter = String.fromCharCode(65 + i);
                        const isSel = selected === i;
                        return (
                          <button
                            key={i}
                            onClick={() => selectAnswer(q.id, i)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 14,
                              padding: '14px 18px', width: '100%',
                              background: isSel
                                ? '#eff6ff'
                                : '#fff',
                              border: `2px solid ${isSel ? '#306ca0' : '#e5e7eb'}`,
                              borderRadius: 12, cursor: 'pointer',
                              textAlign: 'left' as const,
                              transition: 'all 0.15s ease',
                              boxShadow: 'none',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSel) {
                                e.currentTarget.style.borderColor = '#306ca0';
                                e.currentTarget.style.background = '#f8faff';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSel) {
                                e.currentTarget.style.borderColor = '#e5e7eb';
                                e.currentTarget.style.background = '#fff';
                              }
                            }}
                          >
                            <span style={{
                              width: 40, height: 40, borderRadius: '50%',
                              border: isSel ? '2px solid #306ca0' : '2px solid #d1d5db',
                              background: isSel ? '#306ca0' : '#f8fafc',
                              color: isSel ? '#fff' : '#64748b',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 16, fontWeight: 700, flexShrink: 0,
                              transition: 'all 0.15s ease',
                            }}>
                              {letter}
                            </span>
                            <span style={{
                              flex: 1, fontSize: 15, color: isSel ? '#306ca0' : '#374151',
                              fontWeight: isSel ? 600 : 400, lineHeight: 1.5,
                            }}>
                              <MathText text={opt} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Blue Bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 24px', height: 48, flexShrink: 0,
            background: '#306ca0',
          }}>
            <span
              onClick={() => setShowEndTestDialog(true)}
              style={{
                color: '#ffffff', fontSize: 15, fontWeight: 400,
                fontFamily: "'Times New Roman', Times, serif",
                cursor: 'pointer', userSelect: 'none',
              }}
            >
              End Exam
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <span
                onClick={() => {
                  if (!isFirstQ) {
                    accumulateCurrentQTime();
                    setCurrentQ((c) => c - 1);
                    setSelected(answers[questions[currentQ - 1]?.id] ?? null);
                    activeQStartRef.current = Date.now();
                  }
                }}
                style={{
                  color: '#ffffff', fontSize: 15, fontWeight: 400,
                  fontFamily: "'Times New Roman', Times, serif",
                  cursor: isFirstQ ? 'default' : 'pointer',
                  opacity: isFirstQ ? 0.4 : 1,
                  userSelect: 'none',
                }}
              >
                Previous
              </span>
              <span
                onClick={() => setShowNavigator(true)}
                style={{
                  color: '#ffffff', fontSize: 15, fontWeight: 400,
                  fontFamily: "'Times New Roman', Times, serif",
                  cursor: 'pointer', userSelect: 'none',
                }}
              >
                Navigator
              </span>
              <span
                onClick={() => {
                  if (!isLastQ) {
                    accumulateCurrentQTime();
                    setCurrentQ((c) => c + 1);
                    setSelected(answers[questions[currentQ + 1]?.id] ?? null);
                    activeQStartRef.current = Date.now();
                  } else {
                    const unanswered = questions.filter((q) => answers[q.id] === undefined).length;
                    if (unanswered > 0) {
                      setShowEndTestDialog(true);
                    } else {
                      finishExam();
                    }
                  }
                }}
                style={{
                  color: '#ffffff', fontSize: 15, fontWeight: 400,
                  fontFamily: "'Times New Roman', Times, serif",
                  cursor: 'pointer', userSelect: 'none',
                }}
              >
                {isLastQ ? 'Submit' : 'Next'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Right Sidebar: Webcam + Status ── */}
        <div style={{
          width: 280, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 12,
          padding: '16px 14px',
          background: '#f5f5f5',
          borderLeft: '1px solid #e0e0e0',
          overflowY: 'auto',
        }}>
          {/* Webcam Card */}
          <div style={{
            background: '#fff', borderRadius: 10,
            border: '1px solid #e0e0e0',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 14px',
              background: '#fafafa',
              borderBottom: '1px solid #eee',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#ef4444',
                boxShadow: 'none',
                animation: 'pulse 2s infinite',
              }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
                Live Camera
              </span>
            </div>
            <div style={{ padding: 0 }}>
              <WebcamCapture />
            </div>
          </div>

          {/* Violation Log */}
          <div style={{ flex: 1 }}>
            <ViolationLog />
          </div>
        </div>
      </div>

      {/* Pulse animation for recording indicator */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* ── Navigator Popup ── */}
      {showNavigator && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9998,
        }}
          onClick={() => setShowNavigator(false)}
        >
          <div style={{
            background: '#fff', borderRadius: 12,
            boxShadow: 'none',
            width: 480, maxWidth: '90vw', padding: 24,
          }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 16,
            }}>
              <h3 style={{
                margin: 0, fontSize: 16, fontWeight: 600, color: '#333',
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                Question Palette
              </h3>
              <span style={{
                fontSize: 12, color: '#888',
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                {answeredCount}/{questions.length} answered
              </span>
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 11, color: '#888' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#22c55e' }} />
                Answered
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#e0e0e0', border: '1px solid #ccc' }} />
                Pending
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="#d97706" stroke="#d97706" strokeWidth="2">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                  <line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
                Flagged
              </span>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)',
              gap: 5,
            }}>
              {questions.map((_, i) => {
                const qId = questions[i]?.id;
                const isAnswered = answers[qId] !== undefined;
                const isCurrent = currentQ === i;
                const isFlagged = qId && flaggedQuestions.has(qId);
                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (i !== currentQ) {
                        accumulateCurrentQTime();
                        setCurrentQ(i);
                        setSelected(answers[qId] ?? null);
                        activeQStartRef.current = Date.now();
                      }
                      setShowNavigator(false);
                    }}
                    style={{
                      aspectRatio: '1',
                      border: isCurrent
                        ? '2px solid #306ca0'
                        : isAnswered
                          ? '1px solid #22c55e'
                          : '1px solid #d0d0d0',
                      borderRadius: 4,
                      background: isCurrent
                        ? '#dbeafe'
                        : isAnswered
                          ? '#dcfce7'
                          : '#fff',
                      cursor: 'pointer',
                      fontSize: 12, fontWeight: isCurrent ? 700 : 500,
                      color: isCurrent ? '#1e40af' : isAnswered ? '#166534' : '#666',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      position: 'relative' as const,
                    }}
                    title={isFlagged ? 'Flagged' : undefined}
                  >
                    {i + 1}
                    {isFlagged && (
                      <svg style={{ position: 'absolute', top: 1, right: 1 }} width="8" height="8" viewBox="0 0 24 24" fill="#d97706" stroke="#d97706" strokeWidth="2">
                        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setShowNavigator(false)}
              style={{
                width: '100%', marginTop: 16, padding: '8px',
                background: '#306ca0', color: '#fff', border: 'none',
                borderRadius: 4, cursor: 'pointer', fontSize: 14,
                fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── End Test Dialog ── */}
      {showEndTestDialog && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            background: '#fff', borderRadius: 12,
            boxShadow: 'none',
            width: 480, maxWidth: '90vw',
            overflow: 'hidden',
          }}>
            {/* Dialog header */}
            <div style={{
              padding: '20px 24px 16px',
              borderBottom: '1px solid #eee',
            }}>
              <h3 style={{
                margin: 0, fontSize: 18, fontWeight: 600, color: '#333',
                fontFamily: "'Times New Roman', Times, serif",
              }}>
                End Test
              </h3>
            </div>

            {/* Dialog body */}
            <div style={{ padding: '20px 24px' }}>
              {(() => {
                const unansweredQs = questions
                  .map((q, i) => ({ index: i, id: q.id }))
                  .filter(({ id }) => answers[id] === undefined);

                if (unansweredQs.length > 0) {
                  return (
                    <>
                      <p style={{
                        margin: '0 0 12px 0', fontSize: 14, color: '#555',
                        fontFamily: "'Times New Roman', Times, serif",
                        lineHeight: 1.6,
                      }}>
                        You have <strong style={{ color: '#d97706' }}>{unansweredQs.length} unanswered question{unansweredQs.length > 1 ? 's' : ''}</strong>:
                      </p>
                      <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 6,
                        marginBottom: 16,
                      }}>
                        {unansweredQs.map(({ index }) => (
                          <span key={index} style={{
                            padding: '4px 12px', borderRadius: 4,
                            background: '#fef3c7', color: '#92400e',
                            fontSize: 13, fontWeight: 600,
                            fontFamily: "'Times New Roman', Times, serif",
                          }}>
                            Question {index + 1}
                          </span>
                        ))}
                      </div>
                      <p style={{
                        margin: 0, fontSize: 13, color: '#888',
                        fontFamily: "'Times New Roman', Times, serif",
                      }}>
                        Are you sure you want to end the test? You will not be able to change your answers after submission.
                      </p>
                    </>
                  );
                }
                return (
                  <p style={{
                    margin: 0, fontSize: 14, color: '#555',
                    fontFamily: "'Times New Roman', Times, serif",
                  }}>
                    All questions have been answered. Are you sure you want to submit?
                  </p>
                );
              })()}
            </div>

            {/* Dialog footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid #eee',
              display: 'flex', justifyContent: 'flex-end', gap: 12,
            }}>
              <button
                onClick={() => setShowEndTestDialog(false)}
                style={{
                  padding: '8px 24px', borderRadius: 4,
                  border: '1px solid #ccc', background: '#fff',
                  cursor: 'pointer', fontSize: 14, fontWeight: 400,
                  color: '#333', fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowEndTestDialog(false);
                  finishExam();
                }}
                style={{
                  padding: '8px 24px', borderRadius: 4,
                  background: '#306ca0', border: 'none',
                  cursor: 'pointer', fontSize: 14, fontWeight: 400,
                  color: '#fff', fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                End Test
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

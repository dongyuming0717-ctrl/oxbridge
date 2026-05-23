import { createContext, useCallback, useRef, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { ProctorState, Violation, ViolationType } from './types';

interface ProctorContextValue extends ProctorState {
  supabase: typeof supabase;
  user: User | null;
  session: Session | null;
  signOut: () => Promise<void>;
  startSession: (examId: string, userId: string) => void;
  endSession: () => void;
  resetSession: () => void;
  reportViolation: (type: ViolationType, detail?: string) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const ProctorContext = createContext<ProctorContextValue | null>(null);

function genId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ProctorProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const [state, setState] = useState<ProctorState>({
    sessionId: null,
    status: 'idle',
    violations: [],
    faceDetected: false,
    faceCount: 0,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const violationBuffer = useRef<Violation[]>([]);
  const flushTimer = useRef<ReturnType<typeof setInterval>>();
  const currentSessionId = useRef<string | null>(null);

  // Auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setState((s) => ({ ...s, status: 'ended' }));
  }, []);

  // Flush violations to Supabase every 3 seconds
  const flushViolations = useCallback(async () => {
    const sid = currentSessionId.current;
    if (violationBuffer.current.length === 0 || !sid) return;
    const batch = violationBuffer.current.splice(0);
    const rows = batch.map((v) => ({
      session_id: sid,
      event_type: v.type,
      detail: { message: v.detail },
      severity: 'low' as const,
    }));

    const { error } = await supabase.from('exam_logs').insert(rows);
    if (error) {
      violationBuffer.current.push(...batch);
    }
  }, []);

  useEffect(() => {
    if (state.status === 'active') {
      flushTimer.current = setInterval(flushViolations, 3000);
    }
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current);
    };
  }, [state.status, flushViolations]);

  // Start session: immediately set active, Supabase is best-effort
  const startSession = useCallback((examId: string, userId: string) => {
    const localId = genId();
    currentSessionId.current = localId;

    setState((s) => ({
      ...s,
      sessionId: localId,
      status: 'active',
      violations: [],
    }));

    // Async: try to persist to Supabase
    supabase
      .from('exam_sessions')
      .insert({ id: localId, user_id: userId, paper_id: examId, status: 'active', answers: {} })
      .select('id')
      .single()
      .then(({ data, error }) => {
        if (data && !error) {
          currentSessionId.current = data.id;
        }
      });
  }, []);

  const endSession = useCallback(() => {
    const sid = currentSessionId.current;
    // Flush remaining violations
    flushViolations();

    // Best-effort update to Supabase
    if (sid) {
      supabase
        .from('exam_sessions')
        .update({ status: 'completed', ended_at: new Date().toISOString() })
        .eq('id', sid)
        .then(() => {});
    }

    setState((s) => ({ ...s, status: 'ended' }));
  }, [flushViolations]);

  const resetSession = useCallback(() => {
    currentSessionId.current = null;
    violationBuffer.current = [];
    if (flushTimer.current) clearInterval(flushTimer.current);
    setState({ sessionId: null, status: 'idle', violations: [], faceDetected: false, faceCount: 0 });
  }, []);

  const reportViolation = useCallback((type: ViolationType, detail?: string) => {
    const violation: Violation = { type, detail: detail || '', timestamp: new Date() };
    violationBuffer.current.push(violation);
    setState((s) => ({ ...s, violations: [...s.violations, violation] }));
  }, []);

  const setFaceDetection = useCallback((detected: boolean, count: number) => {
    setState((s) => {
      if (s.faceDetected === detected && s.faceCount === count) return s;
      return { ...s, faceDetected: detected, faceCount: count };
    });
  }, []);

  const faceRef = useRef(setFaceDetection);
  faceRef.current = setFaceDetection;

  useEffect(() => {
    (window as any).__proctorFaceUpdate = (detected: boolean, count: number) => {
      faceRef.current(detected, count);
    };
    return () => {
      delete (window as any).__proctorFaceUpdate;
    };
  }, []);

  return (
    <ProctorContext.Provider
      value={{
        ...state,
        supabase,
        user,
        session,
        signOut,
        startSession,
        endSession,
        resetSession,
        reportViolation,
        videoRef,
      }}
    >
      {children}
    </ProctorContext.Provider>
  );
}

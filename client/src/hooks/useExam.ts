import { useState, useCallback } from 'react';
import { supabase } from '../supabase';

export interface Paper {
  id: string;
  title: string;
  paper_number: 1 | 2;
  year: number;
  sitting: string;
  duration_minutes: number;
  total_marks: number;
  topics: string[];
  questions: Question[];
  created_at: string;
}

export interface Question {
  id: string;
  text: string;
  image_url?: string;
  options: string[];
  answer: number;
  topic: string;
}

export interface ExamSession {
  id: string;
  user_id: string;
  paper_id: string;
  status: 'active' | 'paused' | 'completed' | 'terminated';
  answers: Record<string, number>;
  score: number | null;
  started_at: string;
  ended_at: string | null;
}

export function useExam() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPapers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('papers')
      .select('*')
      .order('year', { ascending: false })
      .order('paper_number');

    if (error) {
      console.error('Failed to fetch papers:', error);
      setLoading(false);
      return [];
    }

    setPapers(data as Paper[]);
    setLoading(false);
    return data as Paper[];
  }, []);

  const startExam = useCallback(async (userId: string, paperId: string): Promise<ExamSession | null> => {
    const { data, error } = await supabase
      .from('exam_sessions')
      .insert({
        user_id: userId,
        paper_id: paperId,
        status: 'active',
        answers: {},
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to start exam:', error);
      return null;
    }

    return data as ExamSession;
  }, []);

  const saveAnswers = useCallback(async (sessionId: string, answers: Record<string, number>) => {
    await supabase
      .from('exam_sessions')
      .update({ answers })
      .eq('id', sessionId);
  }, []);

  const finishExam = useCallback(async (sessionId: string, score: number) => {
    await supabase
      .from('exam_sessions')
      .update({
        status: 'completed',
        score,
        ended_at: new Date().toISOString(),
      })
      .eq('id', sessionId);
  }, []);

  const getUserSession = useCallback(async (userId: string, paperId: string) => {
    const { data } = await supabase
      .from('exam_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('paper_id', paperId)
      .eq('status', 'active')
      .maybeSingle();

    return data as ExamSession | null;
  }, []);

  return { papers, loading, fetchPapers, startExam, saveAnswers, finishExam, getUserSession };
}

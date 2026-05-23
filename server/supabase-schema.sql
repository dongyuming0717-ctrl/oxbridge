-- ============================================================
-- TMUA Online Exam Platform — Supabase Schema
-- Run this in Supabase SQL Editor (https://xudhsltojyyzamhmmcei.supabase.co)
-- ============================================================

-- Clean up existing objects (safe to re-run)
DROP TABLE IF EXISTS exam_logs CASCADE;
DROP TABLE IF EXISTS exam_sessions CASCADE;
DROP TABLE IF EXISTS papers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. USERS — extends Supabase auth.users
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  target_uni TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  USING (auth_id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth_id = auth.uid());

-- Auto-create users profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user;
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (auth_id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- 2. PAPERS — TMUA exam papers
-- ============================================================
CREATE TABLE papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  paper_number INT CHECK (paper_number IN (1, 2)),
  year INT NOT NULL,
  sitting TEXT NOT NULL,
  duration_minutes INT DEFAULT 75,
  total_marks INT DEFAULT 20,
  topics TEXT[] DEFAULT '{}',
  questions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read papers"
  ON papers FOR SELECT
  USING (true);


-- 3. EXAM_SESSIONS — student exam attempts
-- ============================================================
CREATE TABLE exam_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  paper_id UUID REFERENCES papers(id) NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'terminated')),
  answers JSONB DEFAULT '{}',
  question_times JSONB DEFAULT '{}',
  score INT,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ
);

ALTER TABLE exam_sessions ENABLE ROW LEVEL SECURITY;

-- Migration: add question_times for existing deployments that lack the column
DO $$ BEGIN
  ALTER TABLE exam_sessions ADD COLUMN question_times JSONB DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE POLICY "Students can read own sessions"
  ON exam_sessions FOR SELECT
  USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Students can insert own sessions"
  ON exam_sessions FOR INSERT
  WITH CHECK (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "Students can update own sessions"
  ON exam_sessions FOR UPDATE
  USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));


-- 4. EXAM_LOGS — proctoring monitoring events
-- ============================================================
CREATE TABLE exam_logs (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES exam_sessions(id) NOT NULL,
  event_type TEXT NOT NULL,
  detail JSONB DEFAULT '{}',
  severity TEXT DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high')),
  recorded_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE exam_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can read own exam logs"
  ON exam_logs FOR SELECT
  USING (session_id IN (
    SELECT es.id FROM exam_sessions es
    JOIN users u ON es.user_id = u.id
    WHERE u.auth_id = auth.uid()
  ));

CREATE POLICY "Students can insert own exam logs"
  ON exam_logs FOR INSERT
  WITH CHECK (session_id IN (
    SELECT es.id FROM exam_sessions es
    JOIN users u ON es.user_id = u.id
    WHERE u.auth_id = auth.uid()
  ));


-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_exam_sessions_user_id ON exam_sessions(user_id);
CREATE INDEX idx_exam_sessions_paper_id ON exam_sessions(paper_id);
CREATE INDEX idx_exam_sessions_status ON exam_sessions(status);
CREATE INDEX idx_exam_logs_session_id ON exam_logs(session_id);
CREATE INDEX idx_exam_logs_recorded_at ON exam_logs(recorded_at);
CREATE INDEX idx_exam_logs_event_type ON exam_logs(event_type);
CREATE INDEX idx_papers_year_paper ON papers(year, paper_number);


-- ============================================================
-- REAL-TIME — enable for exam_logs
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE exam_logs;


-- ============================================================
-- SAMPLE DATA — 2024 TMUA Paper 1 (3 sample questions)
-- ============================================================
INSERT INTO papers (title, paper_number, year, sitting, duration_minutes, total_marks, topics, questions)
VALUES (
  'TMUA 2024 October Paper 1',
  1,
  2024,
  'October',
  75,
  20,
  ARRAY['algebra', 'calculus', 'functions', 'trigonometry'],
  '[
    {
      "id": "q1",
      "text": "Find the value of $$\\int_0^2 (3x^2 - 2x + 1)\\,dx$$",
      "options": ["4", "6", "8", "10"],
      "answer": 1,
      "topic": "calculus"
    },
    {
      "id": "q2",
      "text": "If $$f(x) = \\ln(x^2 + 1)$$, then $$f''(0)$$ equals:",
      "options": ["0", "1", "2", "-2"],
      "answer": 2,
      "topic": "calculus"
    },
    {
      "id": "q3",
      "text": "Solve for $$x$$: $$2^{2x+1} = 8^{x-1}$$",
      "options": ["x = 2", "x = 3", "x = 4", "x = 5"],
      "answer": 2,
      "topic": "algebra"
    }
  ]'::jsonb
);

-- ============================================================
-- TMUA 2023 October Paper 1 (20 questions with images)
-- Images are served from client/public/question-images/
-- ============================================================
INSERT INTO papers (title, paper_number, year, sitting, duration_minutes, total_marks, topics, questions)
VALUES (
  'TMUA 2023 October Paper 1',
  1,
  2023,
  'October',
  75,
  20,
  ARRAY['algebra', 'calculus', 'functions', 'trigonometry', 'geometry', 'sequences'],
  '[
    {"id": "q1",  "text": "TMUA 2023 Paper 1 Question 1",  "image_url": "/question-images/2023_paper1_q01.jpg", "options": ["A","B","C","D","E","F","G"],   "answer": 5, "topic": "algebra"},
    {"id": "q2",  "text": "TMUA 2023 Paper 1 Question 2",  "image_url": "/question-images/2023_paper1_q02.jpg", "options": ["A","B","C","D","E","F"],       "answer": 0, "topic": "algebra"},
    {"id": "q3",  "text": "TMUA 2023 Paper 1 Question 3",  "image_url": "/question-images/2023_paper1_q03.jpg", "options": ["A","B","C","D","E","F"],       "answer": 2, "topic": "calculus"},
    {"id": "q4",  "text": "TMUA 2023 Paper 1 Question 4",  "image_url": "/question-images/2023_paper1_q04.jpg", "options": ["A","B","C","D","E"],           "answer": 2, "topic": "sequences"},
    {"id": "q5",  "text": "TMUA 2023 Paper 1 Question 5",  "image_url": "/question-images/2023_paper1_q05.jpg", "options": ["A","B","C","D","E","F"],       "answer": 5, "topic": "geometry"},
    {"id": "q6",  "text": "TMUA 2023 Paper 1 Question 6",  "image_url": "/question-images/2023_paper1_q06.jpg", "options": ["A","B","C","D","E","F","G"],   "answer": 4, "topic": "algebra"},
    {"id": "q7",  "text": "TMUA 2023 Paper 1 Question 7",  "image_url": "/question-images/2023_paper1_q07.jpg", "options": ["A","B","C","D","E","F","G"],   "answer": 5, "topic": "algebra"},
    {"id": "q8",  "text": "TMUA 2023 Paper 1 Question 8",  "image_url": "/question-images/2023_paper1_q08.jpg", "options": ["A","B","C","D","E"],           "answer": 1, "topic": "trigonometry"},
    {"id": "q9",  "text": "TMUA 2023 Paper 1 Question 9",  "image_url": "/question-images/2023_paper1_q09.jpg", "options": ["A","B","C","D","E","F"],       "answer": 4, "topic": "trigonometry"},
    {"id": "q10", "text": "TMUA 2023 Paper 1 Question 10", "image_url": "/question-images/2023_paper1_q10.jpg", "options": ["A","B","C","D","E","F"],       "answer": 1, "topic": "calculus"},
    {"id": "q11", "text": "TMUA 2023 Paper 1 Question 11", "image_url": "/question-images/2023_paper1_q11.jpg", "options": ["A","B","C","D","E","F"],       "answer": 1, "topic": "functions"},
    {"id": "q12", "text": "TMUA 2023 Paper 1 Question 12", "image_url": "/question-images/2023_paper1_q12.jpg", "options": ["A","B","C","D","E","F","G"],   "answer": 5, "topic": "trigonometry"},
    {"id": "q13", "text": "TMUA 2023 Paper 1 Question 13", "image_url": "/question-images/2023_paper1_q13.jpg", "options": ["A","B","C","D","E","F","G"],   "answer": 5, "topic": "geometry"},
    {"id": "q14", "text": "TMUA 2023 Paper 1 Question 14", "image_url": "/question-images/2023_paper1_q14.jpg", "options": ["A","B","C","D","E","F","G","H"], "answer": 0, "topic": "functions"},
    {"id": "q15", "text": "TMUA 2023 Paper 1 Question 15", "image_url": "/question-images/2023_paper1_q15.jpg", "options": ["A","B","C","D","E","F"],       "answer": 5, "topic": "functions"},
    {"id": "q16", "text": "TMUA 2023 Paper 1 Question 16", "image_url": "/question-images/2023_paper1_q16.jpg", "options": ["A","B","C","D","E","F","G"],   "answer": 4, "topic": "geometry"},
    {"id": "q17", "text": "TMUA 2023 Paper 1 Question 17", "image_url": "/question-images/2023_paper1_q17.jpg", "options": ["A","B","C","D","E","F"],       "answer": 4, "topic": "geometry"},
    {"id": "q18", "text": "TMUA 2023 Paper 1 Question 18", "image_url": "/question-images/2023_paper1_q18.jpg", "options": ["A","B","C","D","E","F","G","H"], "answer": 4, "topic": "sequences"},
    {"id": "q19", "text": "TMUA 2023 Paper 1 Question 19", "image_url": "/question-images/2023_paper1_q19.jpg", "options": ["A","B","C","D","E","F","G","H"], "answer": 3, "topic": "calculus"},
    {"id": "q20", "text": "TMUA 2023 Paper 1 Question 20", "image_url": "/question-images/2023_paper1_q20.jpg", "options": ["A","B","C","D","E","F","G","H"], "answer": 5, "topic": "functions"}
  ]'::jsonb
);

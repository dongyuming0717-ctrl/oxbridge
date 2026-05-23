-- ============================================================
-- Migration: Add teacher role + admin RLS policies
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add 'teacher' to the role CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'admin', 'teacher'));

-- 2. Allow admins/teachers to read ALL users
DROP POLICY IF EXISTS "Admins can read all users" ON users;
CREATE POLICY "Admins can read all users"
  ON users FOR SELECT
  USING (
    (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('admin', 'teacher')
    OR auth_id = auth.uid()
  );

-- 3. Allow admins/teachers to read ALL exam sessions
DROP POLICY IF EXISTS "Admins can read all sessions" ON exam_sessions;
CREATE POLICY "Admins can read all sessions"
  ON exam_sessions FOR SELECT
  USING (
    (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('admin', 'teacher')
  );

-- 4. Allow admins/teachers to read ALL exam logs
DROP POLICY IF EXISTS "Admins can read all exam logs" ON exam_logs;
CREATE POLICY "Admins can read all exam logs"
  ON exam_logs FOR SELECT
  USING (
    (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('admin', 'teacher')
  );

-- 5. Create a manual admin user (run this, then set a password in Supabase Auth)
-- Replace the email below with your actual teacher email
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'teacher@tmua.com' AND role = 'admin') THEN
    INSERT INTO users (auth_id, email, full_name, role)
    SELECT id, email, 'Teacher Admin', 'admin'
    FROM auth.users
    WHERE email = 'teacher@tmua.com'
    ON CONFLICT (email) DO UPDATE SET role = 'admin';
  END IF;
END $$;

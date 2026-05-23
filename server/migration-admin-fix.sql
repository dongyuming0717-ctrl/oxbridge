-- ============================================================
-- Fix: RLS recursion issue on users table
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Drop the problematic recursive policy
DROP POLICY IF EXISTS "Admins can read all users" ON users;

-- 2. Create a SECURITY DEFINER function to safely check role
--    SECURITY DEFINER bypasses RLS, avoiding infinite recursion
DROP FUNCTION IF EXISTS current_user_role();
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.users WHERE auth_id = auth.uid();
$$;

-- 3. Recreate the admin policy using the safe function
CREATE POLICY "Admins can read all users" ON users FOR SELECT
  USING (current_user_role() IN ('admin', 'teacher') OR auth_id = auth.uid());

-- 4. Fix exam_sessions policy to also use the function
DROP POLICY IF EXISTS "Admins can read all sessions" ON exam_sessions;
CREATE POLICY "Admins can read all sessions" ON exam_sessions FOR SELECT
  USING (current_user_role() IN ('admin', 'teacher'));

-- 5. Fix exam_logs policy to also use the function
DROP POLICY IF EXISTS "Admins can read all exam logs" ON exam_logs;
CREATE POLICY "Admins can read all exam logs" ON exam_logs FOR SELECT
  USING (current_user_role() IN ('admin', 'teacher'));

-- 6. Ensure role is set to admin
UPDATE users SET role = 'admin' WHERE email = 'teacher@tmua.com';

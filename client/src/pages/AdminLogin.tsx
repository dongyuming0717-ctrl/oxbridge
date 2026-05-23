import { useState } from 'react';
import { supabase } from '../supabase';

interface Props {
  onLogin: () => void;
}

export function AdminLogin({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Check role
    const { data: { session } } = await supabase.auth.getSession();
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', session?.user?.id || '')
      .single();

    if (!profile || (profile.role !== 'admin' && profile.role !== 'teacher')) {
      setError('Access denied. Only teachers and admins can access this area.');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    onLogin();
  };

  return (
    <div style={{
      maxWidth: 400, margin: '100px auto', fontFamily: 'system-ui, sans-serif',
      padding: 20,
    }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Teacher Portal</h1>
        <p style={{ color: '#6b7280', marginTop: 8, fontSize: 14 }}>
          Sign in to monitor student exams
        </p>
      </div>

      <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4, color: '#374151' }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="teacher@school.edu"
            style={{
              width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 15, boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4, color: '#374151' }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Enter your password"
            style={{
              width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 15, boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        {error && (
          <div style={{
            padding: '10px 12px', background: '#fef2f2', borderRadius: 8,
            border: '1px solid #fecaca', color: '#dc2626', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '12px', background: loading ? '#93c5fd' : '#2563eb',
            color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
            fontSize: 16, fontWeight: 600, marginTop: 4,
          }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

import { useState } from 'react';
import { supabase } from '../supabase';

export function StudentAuth() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (mode === 'register') {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      // The trigger on_auth_user_created auto-creates the users row with role=student
      setSuccess('Account created! You can now sign in.');
      setMode('login');
      setPassword('');
      setLoading(false);
      return;
    }

    // Login
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '80px auto', fontFamily: "'Times New Roman', Times, serif", padding: 20 }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 400, color: '#333' }}>TMUA Practice Papers</h1>
        <p style={{ color: '#888', marginTop: 6, fontSize: 14 }}>
          {mode === 'login' ? 'Sign in to begin your exam' : 'Create an account to get started'}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {mode === 'register' && (
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: '#374151' }}>
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              placeholder="Your name"
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
                borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none',
              }}
            />
          </div>
        )}

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: '#374151' }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            style={{
              width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: '#374151' }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="At least 6 characters"
            minLength={6}
            style={{
              width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none',
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

        {success && (
          <div style={{
            padding: '10px 12px', background: '#f0fdf4', borderRadius: 8,
            border: '1px solid #bbf7d0', color: '#16a34a', fontSize: 13,
          }}>
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '12px', background: loading ? '#93c5fd' : '#306ca0',
            color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
            fontSize: 15, fontWeight: 400,
          }}
        >
          {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#6b7280' }}>
        {mode === 'login' ? (
          <>Don't have an account? <button onClick={() => { setMode('register'); setError(''); setSuccess(''); }} style={{ background: 'none', border: 'none', color: '#306ca0', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>Register</button></>
        ) : (
          <>Already have an account? <button onClick={() => { setMode('login'); setError(''); setSuccess(''); }} style={{ background: 'none', border: 'none', color: '#306ca0', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>Sign In</button></>
        )}
      </p>
    </div>
  );
}

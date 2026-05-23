import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { AdminLogin } from './AdminLogin';
import { AdminDashboard } from './AdminDashboard';

export function AdminPage() {
  const [role, setRole] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const checkAuth = async () => {
    setChecking(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setRole(null);
      setChecking(false);
      return;
    }

    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', session.user.id)
      .single();

    if (profile && (profile.role === 'admin' || profile.role === 'teacher')) {
      setRole(profile.role);
    } else {
      setRole(null);
      await supabase.auth.signOut();
    }
    setChecking(false);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  if (checking) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 40, textAlign: 'center', color: '#9ca3af' }}>
        Checking authentication...
      </div>
    );
  }

  if (!role) {
    return <AdminLogin onLogin={checkAuth} />;
  }

  return <AdminDashboard />;
}

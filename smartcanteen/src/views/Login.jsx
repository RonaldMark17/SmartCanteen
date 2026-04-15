import { useState } from 'react';
import { API } from '../services/api';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { Skeleton } from '../components/Skeleton';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [seedMessage, setSeedMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const res = await API.login(username, password);
      // Save auth data to local storage
      localStorage.setItem('sc_token', res.access_token);
      localStorage.setItem('sc_user', JSON.stringify(res.user));
      if (res.offline) {
        window.showToast?.('Signed in with offline access saved on this device.', 'warning');
      }
      // Trigger state update in App.jsx
      onLogin();
    } catch (err) {
      setError(err.message || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    try {
      const data = await API.seed();
      setSeedMessage(data?.message || 'Demo data initialized successfully!');
      setTimeout(() => setSeedMessage(''), 4000);
    } catch {
      setError('Failed to seed database. Is the backend running?');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-900 to-fuchsia-900 p-4">
      <div className="bg-white/95 backdrop-blur-lg border border-white/20 rounded-2xl p-10 w-full max-w-md shadow-2xl">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <SparklesIcon className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">SmartCanteen AI</h1>
          <p className="text-sm text-slate-500 mt-1">Predictive Inventory & Sales System</p>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg text-center font-medium">
            {error}
          </div>
        )}
        {seedMessage && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-600 text-sm rounded-lg text-center font-medium">
            {seedMessage}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              required
              placeholder="Username"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <input
              type="password"
              required
              placeholder="Password"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-70 shadow-md hover:shadow-lg active:translate-y-0 hover:-translate-y-0.5"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Skeleton className="h-4 w-16 rounded-md bg-white/35" />
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Demo Seed Data Hint */}
        <div className="mt-8 text-center text-sm text-slate-500">
          First time setup?{' '}
          <button 
            onClick={handleSeed}
            type="button"
            className="text-primary font-semibold hover:underline outline-none"
          >
            Initialize demo data
          </button>
        </div>

      </div>
    </div>
  );
}

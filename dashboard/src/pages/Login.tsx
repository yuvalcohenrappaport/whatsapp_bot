import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError('Wrong password');
        return;
      }
      const { token } = (await res.json()) as { token: string };
      localStorage.setItem('jwt', token);
      navigate('/', { replace: true });
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background gradient-mesh-bg">
      {/* Decorative background orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-[oklch(0.72_0.19_155_/_0.08)] blur-[100px]" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-[oklch(0.65_0.22_300_/_0.06)] blur-[100px]" />
      </div>

      <Card className="card-shine w-full max-w-sm p-8 border-border/50 glow-emerald relative">
        <CardHeader className="p-0 mb-6">
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-subtle glow-emerald">
              <span className="text-emerald text-xl font-bold" style={{ fontFamily: 'var(--font-heading)' }}>W</span>
            </div>
            <CardTitle className="text-2xl text-center" style={{ fontFamily: 'var(--font-heading)' }}>
              WhatsApp Bot
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Dashboard password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="bg-muted/50 border-border/50 focus:border-glow-emerald"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full glow-emerald" disabled={loading || !password}>
              {loading ? 'Logging in...' : 'Log in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

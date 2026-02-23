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
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm p-8">
        <CardHeader className="p-0 mb-6">
          <CardTitle className="text-2xl text-center">WhatsApp Bot</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Dashboard password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !password}>
              {loading ? 'Logging in...' : 'Log in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

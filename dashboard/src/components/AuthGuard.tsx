import { Navigate, Outlet } from 'react-router-dom';

export function AuthGuard() {
  const token = localStorage.getItem('jwt');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

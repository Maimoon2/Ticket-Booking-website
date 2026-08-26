import { type ReactNode } from 'react';
import { Redirect, useLocation } from 'wouter';
import { useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';
import type { UserRole } from '@workspace/api-client-react';

export function ProtectedRoute({ children, allowedRoles }: { children: ReactNode; allowedRoles?: UserRole[] }) {
  const [location] = useLocation();
  const hasToken = !!localStorage.getItem('scenepass_token');
  const meQuery = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });

  if (!hasToken) return <Redirect to={`/login?returnTo=${encodeURIComponent(location)}`} />;

  if (meQuery.isLoading || (meQuery.isError && meQuery.isFetching)) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          <p className="text-sm text-muted-foreground">Checking your session…</p>
        </div>
      </div>
    );
  }

  if (meQuery.isError || !meQuery.data) {
    localStorage.removeItem('scenepass_token');
    return <Redirect to={`/login?returnTo=${encodeURIComponent(location)}`} />;
  }

  if (allowedRoles && !allowedRoles.includes(meQuery.data.role)) {
    const home = meQuery.data.role === 'ADMIN' ? '/admin/dashboard' : meQuery.data.role === 'ORGANISER' ? '/organiser/dashboard' : '/events';
    return <Redirect to={home} />;
  }

  return <>{children}</>;
}

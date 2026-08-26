import { CalendarDays, ChevronDown, Compass, LayoutDashboard, LogIn, Menu, Music2, Ticket, UserRound, UsersRound, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { getGetMeQueryKey, getHealthCheckQueryKey, useGetMe, useHealthCheck } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

export function initials(name?: string) {
  return (name ?? 'ScenePass').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

export function money(value?: number) {
  return `$${(value ?? 0).toFixed(2)}`;
}

export function dateLabel(value?: string, withTime = true) {
  if (!value) return 'Date to be announced';
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', withTime ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 0;
  const title = status === 401 ? 'Sign in to continue' : status === 403 ? 'This area is restricted' : status === 404 ? 'We could not find that' : status === 409 ? 'That just changed' : status === 410 ? 'This hold has expired' : 'The connection missed a beat';
  const body = status === 401 ? 'Your account session is needed for this action.' : status === 403 ? 'Your account does not have access to this space.' : status === 409 ? 'Someone else may have taken those seats. Refresh and try again.' : status === 410 ? 'The seats are back in the room. Start a new hold to keep going.' : 'Please try again. If the issue continues, check your connection.';
  return <div className="rounded-2xl border border-primary/25 bg-primary/8 p-6" data-testid="status-api-error">
    <div className="mb-1 flex items-center gap-2 text-sm font-extrabold text-primary"><span className="h-2 w-2 rounded-full bg-primary" /> {title}</div>
    <p className="text-sm text-muted-foreground">{body}</p>
    {onRetry && <button onClick={onRetry} data-testid="button-retry" className="mt-4 rounded-lg bg-secondary px-4 py-2 text-sm font-bold text-secondary-foreground transition hover:-translate-y-0.5">Try again</button>}
  </div>;
}

function SceneLogo() {
  return <Link href="/" data-testid="link-logo" className="group flex items-center gap-2.5">
    <span className="grid h-9 w-9 rotate-[-8deg] place-items-center rounded-[11px] bg-primary text-primary-foreground shadow-[3px_3px_0_hsl(var(--secondary))] transition group-hover:rotate-0"><Ticket size={19} strokeWidth={2.5} /></span>
    <span className="font-display text-xl font-extrabold tracking-[-.04em]">ScenePass</span>
  </Link>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  useHealthCheck({ query: { retry: false, staleTime: 60000, queryKey: getHealthCheckQueryKey() } });
  const meQuery = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });
  const user = meQuery.data;
  const isStaff = user?.role === 'ORGANISER' || user?.role === 'ADMIN';
  const nav = [
    { href: '/', label: 'Discover', icon: Compass },
    { href: '/events', label: 'Browse events', icon: CalendarDays },
    { href: '/my-bookings', label: 'My bookings', icon: Ticket },
    { href: '/waitlist', label: 'Waitlist', icon: UsersRound },
  ];
  const staffNav = user?.role === 'ADMIN'
    ? [{ href: '/admin/dashboard', label: 'Platform overview', icon: LayoutDashboard }, { href: '/admin/venues', label: 'Venues', icon: Music2 }]
    : [{ href: '/organiser/dashboard', label: 'Overview', icon: LayoutDashboard }, { href: '/organiser/events', label: 'My events', icon: Music2 }];
  const active = (href: string) => href === '/' ? location === '/' : location.startsWith(href);
  const go = (href: string) => { setLocation(href); setOpen(false); };
  return <div className="min-h-[100dvh] bg-background">
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 sm:px-8">
        <SceneLogo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
          {nav.slice(0, 2).map((item) => <Link key={item.href} href={item.href} data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`} className={`rounded-lg px-3 py-2 text-sm font-bold transition ${active(item.href) ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{item.label}</Link>)}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          {isStaff && <Link href={user.role === 'ADMIN' ? '/admin/dashboard' : '/organiser/dashboard'} data-testid="link-organiser" className="text-xs font-extrabold uppercase tracking-[.14em] text-muted-foreground transition hover:text-primary">{user.role === 'ADMIN' ? 'Admin console' : 'For organisers'}</Link>}
          {user ? <div className="group relative">
            <button data-testid="button-account-menu" className="flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1.5 text-sm font-bold transition hover:border-primary">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-extrabold text-accent-foreground">{initials(user.name)}</span><span className="max-w-24 truncate">{user.name.split(' ')[0]}</span><ChevronDown size={14} />
            </button>
            <div className="invisible absolute right-0 top-12 w-52 translate-y-1 rounded-xl border border-border bg-card p-2 opacity-0 shadow-scene transition group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
              <button onClick={() => { localStorage.removeItem('scenepass_token'); queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }); setLocation('/login'); }} data-testid="button-logout" className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-muted-foreground hover:bg-muted hover:text-foreground">Sign out</button>
            </div>
          </div> : <Link href={`/login?returnTo=${encodeURIComponent(location)}`} data-testid="link-login-header" className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-extrabold text-primary-foreground transition hover:-translate-y-0.5"><LogIn size={15} /> Sign in</Link>}
        </div>
        <button onClick={() => setOpen((value) => !value)} data-testid="button-mobile-menu" className="grid h-10 w-10 place-items-center rounded-lg border border-border md:hidden">{open ? <X size={19} /> : <Menu size={19} />}</button>
      </div>
      {open && <div className="border-t border-border bg-card p-4 md:hidden">
        {[...nav, ...(isStaff ? staffNav : [])].map((item) => <button key={item.href} onClick={() => go(item.href)} data-testid={`button-mobile-${item.label.toLowerCase().replaceAll(' ', '-')}`} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-bold ${active(item.href) ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'}`}><item.icon size={17} />{item.label}</button>)}
        {!user && <button onClick={() => go(`/login?returnTo=${encodeURIComponent(location)}`)} data-testid="button-mobile-login" className="mt-2 flex w-full items-center gap-3 rounded-lg bg-primary px-3 py-3 text-left text-sm font-bold text-primary-foreground"><LogIn size={17} />Sign in</button>}
        {user && <button onClick={() => { localStorage.removeItem('scenepass_token'); queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }); go('/login'); }} data-testid="button-mobile-logout" className="mt-2 flex w-full items-center gap-3 rounded-lg border border-border px-3 py-3 text-left text-sm font-bold"><UserRound size={17} />Sign out</button>}
      </div>}
    </header>
    {user && isStaff && <div className="border-b border-border/60 bg-secondary text-secondary-foreground">
      <div className="mx-auto flex max-w-[1440px] items-center gap-5 overflow-x-auto px-5 py-2 text-xs font-bold sm:px-8">
        <span className="font-mono-scene whitespace-nowrap uppercase tracking-[.16em] text-primary">{user.role === 'ADMIN' ? 'Admin console' : 'Organiser studio'}</span>
        {staffNav.map((item) => <button key={item.href} onClick={() => go(item.href)} data-testid={`button-staff-${item.label.toLowerCase().replaceAll(' ', '-')}`} className={`whitespace-nowrap transition ${active(item.href) ? 'text-primary' : 'text-secondary-foreground/60 hover:text-secondary-foreground'}`}>{item.label}</button>)}
      </div>
    </div>}
    <main>{children}</main>
    <footer className="border-t border-border/70 bg-card">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 font-display font-bold text-foreground"><span className="h-2 w-2 rounded-full bg-primary" /> ScenePass</div>
        <div className="flex gap-5"><Link href="/events" data-testid="link-footer-events" className="hover:text-primary">Events</Link>{user ? <Link href="/my-bookings" data-testid="link-footer-bookings" className="hover:text-primary">My bookings</Link> : <Link href={`/login?returnTo=${encodeURIComponent(location)}`} data-testid="link-footer-login" className="hover:text-primary">Sign in</Link>}<span>Made for the moments between the lights going down.</span></div>
      </div>
    </footer>
  </div>;
}

export function PageFrame({ eyebrow, title, intro, children, action }: { eyebrow?: string; title: string; intro?: string; children: ReactNode; action?: ReactNode }) {
  return <div className="mx-auto max-w-[1440px] px-5 py-9 sm:px-8 lg:py-14">
    <div className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div className="max-w-3xl scene-enter">
        {eyebrow && <p className="font-mono-scene text-[11px] font-medium uppercase tracking-[.2em] text-primary">{eyebrow}</p>}
        <h1 className="mt-2 font-display text-4xl font-extrabold leading-[.98] tracking-[-.05em] sm:text-6xl">{title}</h1>
        {intro && <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{intro}</p>}
      </div>
      {action && <div className="scene-enter-delay">{action}</div>}
    </div>
    {children}
  </div>;
}

export function LoadingGrid({ rows = 4 }: { rows?: number }) {
  return <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-testid="loading-events">{Array.from({ length: rows }).map((_, index) => <div key={index} className="overflow-hidden rounded-2xl border border-border bg-card"><div className="skeleton h-48" /><div className="space-y-3 p-4"><div className="skeleton h-3 w-16 rounded" /><div className="skeleton h-5 w-4/5 rounded" /><div className="skeleton h-3 w-3/5 rounded" /></div></div>)}</div>;
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warning' | 'bad' }) {
  return <span data-testid="status-pill" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.12em] ${tone === 'good' ? 'bg-accent/12 text-accent' : tone === 'warning' ? 'bg-primary/12 text-primary' : tone === 'bad' ? 'bg-destructive/12 text-destructive' : 'bg-muted text-muted-foreground'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{children}</span>;
}
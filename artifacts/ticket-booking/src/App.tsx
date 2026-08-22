import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppShell } from '@/components/app-shell';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AdminDashboardPage, AdminVenueDetailPage, AdminVenuesPage, AuthPage, BookingPage, CheckoutPage, EventDetailPage, EventFormPage, EventsPage, HomePage, MyBookingsPage, OrganiserDashboardPage, OrganiserEventDetailPage, OrganiserEventsPage, SeatsPage, VenueFormPage, VenueSeatsPage, WaitlistPage } from '@/pages/scenes';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Router() {
  return <RoutedErrorBoundary><AppShell><Switch>
    <Route path="/" component={HomePage} />
    <Route path="/login"><AuthPage mode="login" /></Route>
    <Route path="/register"><AuthPage mode="register" /></Route>
    <Route path="/events" component={EventsPage} />
    <Route path="/events/:id/seats" component={SeatsPage} />
    <Route path="/events/:id" component={EventDetailPage} />
    <Route path="/checkout" component={CheckoutPage} />
    <Route path="/booking/:id" component={BookingPage} />
    <Route path="/my-bookings" component={MyBookingsPage} />
    <Route path="/waitlist" component={WaitlistPage} />
    <Route path="/organiser/dashboard" component={OrganiserDashboardPage} />
    <Route path="/organiser/events/create"><EventFormPage /></Route>
    <Route path="/organiser/events/:id/edit"><EventFormPage edit /></Route>
    <Route path="/organiser/events/:id" component={OrganiserEventDetailPage} />
    <Route path="/organiser/events" component={OrganiserEventsPage} />
    <Route path="/admin/dashboard" component={AdminDashboardPage} />
    <Route path="/admin/venues/create"><VenueFormPage /></Route>
    <Route path="/admin/venues/:id/edit"><VenueFormPage /></Route>
    <Route path="/admin/venues/:id/seats" component={VenueSeatsPage} />
    <Route path="/admin/venues/:id" component={AdminVenueDetailPage} />
    <Route path="/admin/venues" component={AdminVenuesPage} />
    <Route component={NotFound} />
  </Switch></AppShell></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  useEffect(() => {
    setAuthTokenGetter(() => localStorage.getItem('scenepass_token'));
    document.title = 'ScenePass — Find your scene';
  }, []);
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppShell } from '@/components/app-shell';
import { ProtectedRoute } from '@/components/protected-route';
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
    <Route path="/checkout"><ProtectedRoute allowedRoles={['CUSTOMER']}><CheckoutPage /></ProtectedRoute></Route>
    <Route path="/booking/:id"><ProtectedRoute><BookingPage /></ProtectedRoute></Route>
    <Route path="/my-bookings"><ProtectedRoute allowedRoles={['CUSTOMER']}><MyBookingsPage /></ProtectedRoute></Route>
    <Route path="/waitlist"><ProtectedRoute allowedRoles={['CUSTOMER']}><WaitlistPage /></ProtectedRoute></Route>
    <Route path="/organiser/dashboard"><ProtectedRoute allowedRoles={['ORGANISER', 'ADMIN']}><OrganiserDashboardPage /></ProtectedRoute></Route>
    <Route path="/organiser/events/create"><ProtectedRoute allowedRoles={['ORGANISER', 'ADMIN']}><EventFormPage /></ProtectedRoute></Route>
    <Route path="/organiser/events/:id/edit"><ProtectedRoute allowedRoles={['ORGANISER', 'ADMIN']}><EventFormPage edit /></ProtectedRoute></Route>
    <Route path="/organiser/events/:id"><ProtectedRoute allowedRoles={['ORGANISER', 'ADMIN']}><OrganiserEventDetailPage /></ProtectedRoute></Route>
    <Route path="/organiser/events"><ProtectedRoute allowedRoles={['ORGANISER', 'ADMIN']}><OrganiserEventsPage /></ProtectedRoute></Route>
    <Route path="/admin/dashboard"><ProtectedRoute allowedRoles={['ADMIN']}><AdminDashboardPage /></ProtectedRoute></Route>
    <Route path="/admin/venues/create"><ProtectedRoute allowedRoles={['ADMIN']}><VenueFormPage /></ProtectedRoute></Route>
    <Route path="/admin/venues/:id/edit"><ProtectedRoute allowedRoles={['ADMIN']}><VenueFormPage /></ProtectedRoute></Route>
    <Route path="/admin/venues/:id/seats"><ProtectedRoute allowedRoles={['ADMIN']}><VenueSeatsPage /></ProtectedRoute></Route>
    <Route path="/admin/venues/:id"><ProtectedRoute allowedRoles={['ADMIN']}><AdminVenueDetailPage /></ProtectedRoute></Route>
    <Route path="/admin/venues"><ProtectedRoute allowedRoles={['ADMIN']}><AdminVenuesPage /></ProtectedRoute></Route>
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
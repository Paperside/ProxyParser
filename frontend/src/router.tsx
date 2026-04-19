import {
  Navigate,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter
} from "@tanstack/react-router";

import { AppShell } from "./components/app-shell";
import { useAuth } from "./providers/auth-provider";
import { DashboardPage } from "./pages/dashboard-page";
import { GeneratedSubscriptionWizardPage } from "./pages/generated-subscription-wizard-page";
import { LoginPage } from "./pages/login-page";
import { RegisterPage } from "./pages/register-page";
import { SettingsPage } from "./pages/settings-page";
import { SubscriptionsPage } from "./pages/subscriptions-page";
import { TemplatesPage } from "./pages/templates-page";

const FullscreenLoader = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#eff4fa]">
      <div className="rounded-[28px] border border-white/70 bg-white/80 px-6 py-4 text-sm text-slate-500 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        正在载入工作区...
      </div>
    </div>
  );
};

const RootComponent = () => {
  return <Outlet />;
};

const EntryRedirect = () => {
  const auth = useAuth();

  if (auth.isBooting) {
    return <FullscreenLoader />;
  }

  return <Navigate to={auth.session ? "/dashboard" : "/login"} />;
};

const SubscriptionsRedirect = () => {
  return <Navigate to="/subscriptions/upstream" />;
};

const TemplatesRedirect = () => {
  return <Navigate to="/templates/mine" />;
};

const GuestLayout = () => {
  const auth = useAuth();

  if (auth.isBooting) {
    return <FullscreenLoader />;
  }

  if (auth.session) {
    return <Navigate to="/dashboard" />;
  }

  return <Outlet />;
};

const ProtectedLayout = () => {
  const auth = useAuth();

  if (auth.isBooting) {
    return <FullscreenLoader />;
  }

  if (!auth.session) {
    return <Navigate to="/login" />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
};

const rootRoute = createRootRoute({
  component: RootComponent
});

const entryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: EntryRedirect
});

const guestRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "guest",
  component: GuestLayout
});

const loginRoute = createRoute({
  getParentRoute: () => guestRoute,
  path: "/login",
  component: LoginPage
});

const registerRoute = createRoute({
  getParentRoute: () => guestRoute,
  path: "/register",
  component: RegisterPage
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: ProtectedLayout
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dashboard",
  component: DashboardPage
});

const subscriptionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subscriptions",
  component: SubscriptionsRedirect
});

const subscriptionsUpstreamRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subscriptions/upstream",
  component: () => <SubscriptionsPage section="upstream" />
});

const subscriptionsGeneratedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subscriptions/generated",
  component: () => <SubscriptionsPage section="generated" />
});

const generatedSubscriptionWizardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subscriptions/drafts/$draftId",
  component: GeneratedSubscriptionWizardPage
});

const templatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/templates",
  component: TemplatesRedirect
});

const templatesMineRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/templates/mine",
  component: () => <TemplatesPage section="mine" />
});

const templatesMarketRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/templates/market",
  component: () => <TemplatesPage section="market" />
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsPage
});

const routeTree = rootRoute.addChildren([
  entryRoute,
  guestRoute.addChildren([loginRoute, registerRoute]),
  appRoute.addChildren([
    dashboardRoute,
    subscriptionsRoute,
    subscriptionsUpstreamRoute,
    subscriptionsGeneratedRoute,
    generatedSubscriptionWizardRoute,
    templatesRoute,
    templatesMineRoute,
    templatesMarketRoute,
    settingsRoute
  ])
]);

export const router = createRouter({
  routeTree
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export const AppRouter = () => {
  return <RouterProvider router={router} />;
};

import {
  Navigate,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useParams
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AppShell } from "./components/app-shell";
import { useAuth } from "./providers/auth-provider";
import { LoginPage } from "./pages/login-page";
import { RegisterPage } from "./pages/register-page";

// 路由级代码分割（技术方案 §14.2）
const WorkbenchPage = lazy(() =>
  import("./pages/workbench-page").then((m) => ({ default: m.WorkbenchPage }))
);
const SubscriptionsPage = lazy(() =>
  import("./pages/subscriptions-page").then((m) => ({ default: m.SubscriptionsPage }))
);
const NewSubscriptionPage = lazy(() =>
  import("./pages/new-subscription-page").then((m) => ({ default: m.NewSubscriptionPage }))
);
const SubscriptionWorkspacePage = lazy(() =>
  import("./pages/subscription-workspace-page").then((m) => ({
    default: m.SubscriptionWorkspacePage
  }))
);
const SourcesPage = lazy(() =>
  import("./pages/sources-page").then((m) => ({ default: m.SourcesPage }))
);
const RulesetsPage = lazy(() =>
  import("./pages/rulesets-page").then((m) => ({ default: m.RulesetsPage }))
);
const TemplatesPage = lazy(() =>
  import("./pages/templates-page").then((m) => ({ default: m.TemplatesPage }))
);
const SettingsPage = lazy(() =>
  import("./pages/settings-page").then((m) => ({ default: m.SettingsPage }))
);

const FullscreenLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-bg">
    <div className="rounded-md border border-line bg-surface px-6 py-3 text-sm text-muted">
      正在载入…
    </div>
  </div>
);

const EntryRedirect = () => {
  const auth = useAuth();
  if (auth.isBooting) return <FullscreenLoader />;
  return <Navigate to={auth.session ? "/workbench" : "/login"} />;
};

const GuestLayout = () => {
  const auth = useAuth();
  if (auth.isBooting) return <FullscreenLoader />;
  if (auth.session) return <Navigate to="/workbench" />;
  return <Outlet />;
};

const ProtectedLayout = () => {
  const auth = useAuth();
  if (auth.isBooting) return <FullscreenLoader />;
  if (!auth.session) return <Navigate to="/login" />;
  return (
    <AppShell>
      <Suspense fallback={<FullscreenLoader />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
};

const SubscriptionWorkspaceRedirect = () => {
  const { subscriptionId } = useParams({ strict: false }) as {
    subscriptionId: string;
  };
  return (
    <Navigate
      to="/subscriptions/$subscriptionId/$tab"
      params={{ subscriptionId, tab: "overview" }}
      replace
    />
  );
};

const rootRoute = createRootRoute({ component: () => <Outlet /> });

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

const workbenchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/workbench",
  component: () => <WorkbenchPage />
});

const subscriptionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subscriptions",
  component: () => <SubscriptionsPage />
});

const newSubscriptionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subscriptions/new",
  component: () => <NewSubscriptionPage />
});

const subscriptionWorkspaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subscriptions/$subscriptionId",
  component: SubscriptionWorkspaceRedirect
});

const subscriptionWorkspaceTabRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/subscriptions/$subscriptionId/$tab",
  component: () => <SubscriptionWorkspacePage />
});

const sourcesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/sources",
  component: () => <SourcesPage />
});

const rulesetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/rulesets",
  component: () => <RulesetsPage />
});

const templatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/templates",
  component: () => <TemplatesPage />
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: () => <SettingsPage />
});

const routeTree = rootRoute.addChildren([
  entryRoute,
  guestRoute.addChildren([loginRoute, registerRoute]),
  appRoute.addChildren([
    workbenchRoute,
    subscriptionsRoute,
    newSubscriptionRoute,
    subscriptionWorkspaceRoute,
    subscriptionWorkspaceTabRoute,
    sourcesRoute,
    rulesetsRoute,
    templatesRoute,
    settingsRoute
  ])
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export const AppRouter = () => <RouterProvider router={router} />;

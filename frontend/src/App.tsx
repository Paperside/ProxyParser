import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

import { AppRouter } from "./router";
import { AuthProvider } from "./providers/auth-provider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 }
  }
});

const App = () => (
  <AuthProvider>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--pp-surface-2)",
            border: "1px solid var(--pp-border-strong)",
            color: "var(--pp-text)"
          }
        }}
      />
    </QueryClientProvider>
  </AuthProvider>
);

export default App;

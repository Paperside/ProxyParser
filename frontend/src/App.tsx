import { AppRouter } from "./router";
import { AuthProvider } from "./providers/auth-provider";
import { WorkspaceProvider } from "./providers/workspace-provider";

const App = () => {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <AppRouter />
      </WorkspaceProvider>
    </AuthProvider>
  );
};

export default App;

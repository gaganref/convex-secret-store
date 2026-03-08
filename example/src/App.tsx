import { useState } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppLayout, type Page } from "@/layouts/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { ConnectionsPage } from "@/pages/ConnectionsPage";
import { ActivityPage } from "@/pages/ActivityPage";
import { MaintenancePage } from "@/pages/MaintenancePage";

function AppContent() {
  const { username } = useAuth();
  const [page, setPage] = useState<Page>("connections");

  if (!username) {
    return <LoginPage />;
  }

  return (
    <AppLayout page={page} onNavigate={setPage}>
      {page === "connections" && <ConnectionsPage workspace={username} />}
      {page === "activity" && <ActivityPage workspace={username} />}
      {page === "maintenance" && <MaintenancePage workspace={username} />}
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppLayout } from "@/layouts/AppLayout";
import { useAppRoute } from "@/lib/navigation";
import { LoginPage } from "@/pages/LoginPage";
import { Spinner } from "@/components/ui/spinner";

const ConnectionsPage = lazy(async () => {
  const module = await import("@/pages/ConnectionsPage");
  return { default: module.ConnectionsPage };
});

const ActivityPage = lazy(async () => {
  const module = await import("@/pages/ActivityPage");
  return { default: module.ActivityPage };
});

const MaintenancePage = lazy(async () => {
  const module = await import("@/pages/MaintenancePage");
  return { default: module.MaintenancePage };
});

function RouteFallback() {
  return (
    <div className="flex min-h-72 items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner />
        <span>Loading page</span>
      </div>
    </div>
  );
}

function AppContent() {
  const { username } = useAuth();
  const {
    route: { page, environment },
    setPage,
    setEnvironment,
  } = useAppRoute();

  let pageContent = (
    <ConnectionsPage workspace={username ?? ""} environment={environment} />
  );

  if (page === "activity") {
    pageContent = <ActivityPage workspace={username ?? ""} environment={environment} />;
  } else if (page === "maintenance") {
    pageContent = (
      <MaintenancePage workspace={username ?? ""} environment={environment} />
    );
  }

  if (!username) {
    return <LoginPage />;
  }

  return (
    <AppLayout
      page={page}
      environment={environment}
      onEnvironmentChange={setEnvironment}
      onNavigate={setPage}
    >
      <Suspense fallback={<RouteFallback />}>{pageContent}</Suspense>
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

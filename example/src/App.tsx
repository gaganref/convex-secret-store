import { lazy, Suspense } from "react";
import { AppLayout } from "@/layouts/AppLayout";
import { useAppRoute } from "@/lib/navigation";
import { Spinner } from "@/components/ui/spinner";

const ConnectionsPage = lazy(async () => {
  const module = await import("@/pages/ConnectionsPage");
  return { default: module.ConnectionsPage };
});

const UsagePage = lazy(async () => {
  const module = await import("@/pages/UsagePage");
  return { default: module.UsagePage };
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
  const {
    route: { page, environment, workspace },
    setPage,
    setEnvironment,
    setWorkspace,
  } = useAppRoute();

  let pageContent = (
    <ConnectionsPage workspace={workspace} environment={environment} />
  );

  if (page === "usage") {
    pageContent = <UsagePage workspace={workspace} environment={environment} />;
  } else if (page === "activity") {
    pageContent = <ActivityPage workspace={workspace} environment={environment} />;
  } else if (page === "maintenance") {
    pageContent = <MaintenancePage workspace={workspace} environment={environment} />;
  }

  return (
    <AppLayout
      page={page}
      environment={environment}
      workspace={workspace}
      onEnvironmentChange={setEnvironment}
      onWorkspaceChange={setWorkspace}
      onNavigate={setPage}
    >
      <Suspense fallback={<RouteFallback />}>{pageContent}</Suspense>
    </AppLayout>
  );
}

export default function App() {
  return <AppContent />;
}

import { lazy, Suspense, useState } from "react";
import { useAppRoute } from "@/lib/navigation";
import { Spinner } from "@/components/ui/spinner";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ENVIRONMENTS, type Environment, type Page } from "@/lib/navigation";
import {
  Key,
  ClockCounterClockwise,
  GearSix,
  SignOut,
} from "@phosphor-icons/react";

const SecretsPage = lazy(async () => {
  const module = await import("@/pages/SecretsPage");
  return { default: module.SecretsPage };
});

const ActivityPage = lazy(async () => {
  const module = await import("@/pages/ActivityPage");
  return { default: module.ActivityPage };
});

const SettingsPage = lazy(async () => {
  const module = await import("@/pages/SettingsPage");
  return { default: module.SettingsPage };
});

const PAGE_TABS: { id: Page; label: string; icon: typeof Key }[] = [
  { id: "secrets", label: "Secrets", icon: Key },
  { id: "activity", label: "Activity", icon: ClockCounterClockwise },
  { id: "settings", label: "Settings", icon: GearSix },
];

function RouteFallback() {
  return (
    <div
      className="flex min-h-72 items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner />
        <span>Loading</span>
      </div>
    </div>
  );
}

function AuthScreen({ onEnter }: { onEnter: (workspace: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-xs flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div
              className="flex size-7 items-center justify-center bg-primary text-primary-foreground"
              aria-hidden="true"
            >
              <Key size={14} weight="fill" />
            </div>
            <span className="text-xs font-bold tracking-[0.2em] uppercase">
              Secret Store
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Demo sign-in. Enter a workspace name to scope your secrets.
          </p>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = value.trim();
            if (trimmed.length > 0) onEnter(trimmed);
          }}
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Workspace name (e.g. acme)"
            autoFocus
          />
          <Button type="submit" disabled={value.trim().length === 0}>
            Enter workspace
          </Button>
        </form>
        <p className="text-[10px] text-muted-foreground text-center">
          Used only to scope example data. No real auth.
        </p>
      </div>
    </div>
  );
}

function AppShell() {
  const {
    route: { page, environment, workspace },
    setPage,
    setEnvironment,
    setWorkspace,
  } = useAppRoute();

  if (!workspace) {
    return (
      <AuthScreen
        onEnter={(ws) => {
          setWorkspace(ws);
        }}
      />
    );
  }

  let pageContent: React.ReactNode;
  if (page === "activity") {
    pageContent = (
      <ActivityPage workspace={workspace} environment={environment} />
    );
  } else if (page === "settings") {
    pageContent = (
      <SettingsPage workspace={workspace} environment={environment} />
    );
  } else {
    pageContent = (
      <SecretsPage workspace={workspace} environment={environment} />
    );
  }

  return (
    <div className="min-h-svh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:border focus:bg-background focus:px-3 focus:py-2 focus:text-xs"
      >
        Skip to content
      </a>

      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 py-3">
          {/* Top row: brand + workspace + theme + sign out */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div
                className="flex size-7 items-center justify-center bg-primary text-primary-foreground"
                aria-hidden="true"
              >
                <Key size={14} weight="fill" />
              </div>
              <span className="text-xs font-bold tracking-[0.2em] uppercase">
                Secret Store
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Badge variant="outline">{workspace}</Badge>
              <ThemeSwitcher />
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label="Sign out"
                onClick={() => setWorkspace("")}
              >
                <SignOut size={14} />
              </Button>
            </div>
          </div>

          {/* Environment tabs */}
          <div className="flex items-center gap-1 border-t pt-3">
            {ENVIRONMENTS.map((env) => (
              <Button
                key={env.value}
                size="xs"
                variant={environment === env.value ? "default" : "ghost"}
                onClick={() => setEnvironment(env.value as Environment)}
                className={cn(
                  environment !== env.value && "text-muted-foreground",
                )}
              >
                {env.label}
              </Button>
            ))}
          </div>

          {/* Page tabs */}
          <nav className="flex items-center gap-1" aria-label="Sections">
            {PAGE_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = page === tab.id;
              return (
                <Button
                  key={tab.id}
                  size="xs"
                  variant={isActive ? "default" : "ghost"}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setPage(tab.id)}
                  className={cn(!isActive && "text-muted-foreground")}
                >
                  <Icon
                    size={13}
                    data-icon="inline-start"
                    weight={isActive ? "fill" : "regular"}
                  />
                  {tab.label}
                </Button>
              );
            })}
          </nav>
        </div>
      </header>

      <main id="main-content" className="px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-5xl">
          <Suspense fallback={<RouteFallback />}>{pageContent}</Suspense>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return <AppShell />;
}

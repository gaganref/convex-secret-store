import { startTransition, useEffect, useState } from "react";

export type Page = "secrets" | "activity" | "settings";
export type Environment = "development" | "staging" | "production";

export type AppRoute = {
  page: Page;
  environment: Environment;
  workspace: string;
};

export const DEFAULT_ROUTE: AppRoute = {
  page: "secrets",
  environment: "production",
  workspace: "",
};

export const ENVIRONMENTS: Array<{ label: string; value: Environment }> = [
  { label: "Development", value: "development" },
  { label: "Staging", value: "staging" },
  { label: "Production", value: "production" },
];

function isPage(value: string | null): value is Page {
  return value === "secrets" || value === "activity" || value === "settings";
}

function isEnvironment(value: string | null): value is Environment {
  return (
    value === "development" || value === "staging" || value === "production"
  );
}

function readRoute(hash: string): AppRoute {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const url = new URL(trimmed || "/", "https://vault.local");
  const firstSegment = url.pathname.split("/").filter(Boolean)[0] ?? null;
  const page = isPage(firstSegment) ? firstSegment : DEFAULT_ROUTE.page;
  const environmentParam = url.searchParams.get("environment");
  const environment = isEnvironment(environmentParam)
    ? environmentParam
    : DEFAULT_ROUTE.environment;
  const workspaceParam = url.searchParams.get("workspace")?.trim();
  const workspace =
    workspaceParam && workspaceParam.length > 0 ? workspaceParam : "";
  return { page, environment, workspace };
}

function buildHash(route: AppRoute) {
  const search = new URLSearchParams({
    environment: route.environment,
    workspace: route.workspace,
  });
  return `#/${route.page}?${search.toString()}`;
}

export function useAppRoute() {
  const [route, setRoute] = useState<AppRoute>(() => {
    if (typeof window === "undefined") return DEFAULT_ROUTE;
    return readRoute(window.location.hash);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncRoute = () => {
      const nextRoute = readRoute(window.location.hash);
      startTransition(() => setRoute(nextRoute));
    };

    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  function updateRoute(patch: Partial<AppRoute>) {
    if (typeof window === "undefined") return;
    const nextRoute = { ...readRoute(window.location.hash), ...patch };
    const nextHash = buildHash(nextRoute);
    if (window.location.hash === nextHash) {
      startTransition(() => setRoute(nextRoute));
      return;
    }
    window.location.hash = nextHash;
  }

  return {
    route,
    setPage: (page: Page) => updateRoute({ page }),
    setEnvironment: (environment: Environment) => updateRoute({ environment }),
    setWorkspace: (workspace: string) => updateRoute({ workspace }),
  };
}

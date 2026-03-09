import {
  ArrowsClockwise,
  PlugsConnected,
  Vault,
  Wrench,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { cn } from "@/lib/utils";
import {
  ENVIRONMENT_OPTIONS,
  type Environment,
  type Page,
} from "@/lib/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NAV_ITEMS: { id: Page; label: string; icon: typeof Vault }[] = [
  { id: "connections", label: "Connections", icon: PlugsConnected },
  { id: "usage", label: "Usage", icon: Vault },
  { id: "activity", label: "Activity", icon: ArrowsClockwise },
  { id: "maintenance", label: "Advanced", icon: Wrench },
];

const WORKSPACE_OPTIONS = ["acme", "northwind", "lattice"];

type AppLayoutProps = {
  page: Page;
  environment: Environment;
  workspace: string;
  onNavigate: (page: Page) => void;
  onEnvironmentChange: (environment: Environment) => void;
  onWorkspaceChange: (workspace: string) => void;
  children: ReactNode;
};

export function AppLayout({
  page,
  environment,
  workspace,
  onNavigate,
  onEnvironmentChange,
  onWorkspaceChange,
  children,
}: AppLayoutProps) {
  return (
    <div className="min-h-svh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:border focus:bg-background focus:px-3 focus:py-2 focus:text-xs"
      >
        Skip to content
      </a>

      <header className="border-b">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex size-9 items-center justify-center bg-primary text-primary-foreground shadow-md shadow-primary/25"
                aria-hidden="true"
              >
                <Vault size={18} weight="fill" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold tracking-[0.28em] uppercase leading-none">
                  Secret Vault
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  Reference app for scoped provider credentials
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="uppercase tracking-widest">Workspace</span>
                <Select
                  value={workspace}
                  onValueChange={(value) => {
                    if (value) {
                      onWorkspaceChange(value);
                    }
                  }}
                >
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKSPACE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="uppercase tracking-widest">Environment</span>
                <Select
                  value={environment}
                  onValueChange={(value) =>
                    onEnvironmentChange(value as Environment)
                  }
                >
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENVIRONMENT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <ThemeSwitcher />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
            <nav className="flex flex-wrap gap-2" aria-label="Sections">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = page === item.id;
                return (
                  <Button
                    key={item.id}
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => onNavigate(item.id)}
                    className={cn(
                      "justify-start px-3",
                      !isActive && "text-muted-foreground",
                    )}
                  >
                    <Icon
                      size={13}
                      data-icon="inline-start"
                      weight={isActive ? "fill" : "regular"}
                    />
                    {item.label}
                  </Button>
                );
              })}
            </nav>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{workspace}</Badge>
              <span>/</span>
              <Badge variant="outline">
                {
                  ENVIRONMENT_OPTIONS.find(
                    (option) => option.value === environment,
                  )?.label
                }
              </Badge>
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" className="px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-7xl px-4 md:px-6">{children}</div>
      </main>
    </div>
  );
}

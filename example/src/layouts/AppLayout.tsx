import {
  Vault,
  ArrowsClockwise,
  Wrench,
  SignOut,
  User,
  PlugsConnected,
} from "@phosphor-icons/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { useAuth } from "@/context/AuthContext";
import type { ReactNode } from "react";

export type Page = "connections" | "activity" | "maintenance";

const NAV_ITEMS: { id: Page; label: string; icon: typeof Vault }[] = [
  { id: "connections", label: "Connections", icon: PlugsConnected },
  { id: "activity", label: "Activity", icon: ArrowsClockwise },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
];

type AppLayoutProps = {
  page: Page;
  onNavigate: (page: Page) => void;
  children: ReactNode;
};

export function AppLayout({ page, onNavigate, children }: AppLayoutProps) {
  const { username, logout } = useAuth();
  const currentNav = NAV_ITEMS.find((n) => n.id === page);
  const CurrentIcon = currentNav?.icon;

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div
              className="flex size-8 items-center justify-center bg-primary text-primary-foreground text-sm font-bold select-none shrink-0 shadow-md shadow-primary/25"
              aria-hidden="true"
            >
              <Vault size={16} weight="fill" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold tracking-widest uppercase leading-none">
                Secret
              </span>
              <span className="text-[9px] text-muted-foreground tracking-widest uppercase leading-none mt-1">
                Vault
              </span>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = page === item.id;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={isActive}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => onNavigate(item.id)}
                        className="cursor-pointer"
                      >
                        <Icon weight={isActive ? "fill" : "regular"} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="px-3 py-3 gap-2">
          <Separator />
          <div className="flex items-center gap-2 px-1 py-1">
            <div className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground shrink-0">
              <User size={12} />
            </div>
            <span className="flex-1 text-xs text-muted-foreground truncate">
              {username}
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0"
                      onClick={logout}
                    />
                  }
                >
                  <SignOut size={12} />
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="px-1">
            <ThemeSwitcher />
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-12 items-center gap-3 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          {CurrentIcon && (
            <CurrentIcon size={14} className="text-muted-foreground shrink-0" />
          )}
          <span className="text-sm font-medium">{currentNav?.label}</span>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="mx-auto w-full lg:w-[90%] xl:w-[85%]">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

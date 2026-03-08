import { Sun, Moon, Desktop } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemePreference } from "@/components/theme-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const themeOptions: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Desktop },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <TooltipProvider>
      <div className="inline-flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Theme:</span>
        <div className="inline-flex border border-border p-0.5">
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const isActive = theme === option.value;
            return (
              <Tooltip key={option.value}>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon"
                      variant={isActive ? "default" : "ghost"}
                      className="size-6"
                      onClick={() => setTheme(option.value)}
                      aria-pressed={isActive}
                      aria-label={option.label}
                    />
                  }
                >
                  <Icon size={13} weight={isActive ? "fill" : "regular"} />
                </TooltipTrigger>
                <TooltipContent side="top">{option.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

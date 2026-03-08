/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type ThemePreference = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: ThemePreference;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined,
);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

function applyTheme(theme: ThemePreference) {
  const root = window.document.documentElement;
  const resolvedTheme = theme === "system" ? getSystemTheme() : theme;

  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme);
  root.style.colorScheme = resolvedTheme;
  root.setAttribute("data-theme", theme);
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") {
      return defaultTheme;
    }
    const storedTheme = window.localStorage.getItem(storageKey);
    return isThemePreference(storedTheme) ? storedTheme : defaultTheme;
  });

  useEffect(() => {
    applyTheme(theme);

    const mediaQuery = window.matchMedia(MEDIA_QUERY);
    const handleChange = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) {
        return;
      }
      setThemeState(
        isThemePreference(event.newValue) ? event.newValue : defaultTheme,
      );
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [defaultTheme, storageKey]);

  const value: ThemeProviderState = {
    theme,
    setTheme: (nextTheme) => {
      window.localStorage.setItem(storageKey, nextTheme);
      setThemeState(nextTheme);
    },
  };

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

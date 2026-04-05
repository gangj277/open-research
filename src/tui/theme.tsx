import React, { createContext, useContext } from "react";
import type { Theme } from "@/lib/config/store";

export interface ThemeColors {
  // Primary accent (headers, active items, borders)
  accent: string;
  // Secondary accent (agent messages, success states)
  secondary: string;
  // Warning/attention (busy states, pending items)
  warning: string;
  // Error/danger
  error: string;
  // Muted text (descriptions, hints, timestamps)
  muted: string;
  // Default text
  text: string;
  // Highlighted/selected items
  highlight: string;
  // Skill/mention indicator
  skill: string;
  // File mention indicator
  file: string;
  // Pending review
  pending: string;
  // Border color for focused elements
  borderFocused: string;
  // Border color for unfocused elements
  borderDefault: string;
}

const DARK_THEME: ThemeColors = {
  accent: "cyan",
  secondary: "green",
  warning: "yellow",
  error: "red",
  muted: "gray",
  text: "white",
  highlight: "white",
  skill: "magenta",
  file: "green",
  pending: "magenta",
  borderFocused: "cyan",
  borderDefault: "gray",
};

const LIGHT_THEME: ThemeColors = {
  accent: "blue",
  secondary: "green",
  warning: "#b8860b",
  error: "red",
  muted: "#666666",
  text: "#1a1a1a",
  highlight: "#1a1a1a",
  skill: "#8b008b",
  file: "#006400",
  pending: "#8b008b",
  borderFocused: "blue",
  borderDefault: "#999999",
};

export function getThemeColors(theme: Theme): ThemeColors {
  return theme === "light" ? LIGHT_THEME : DARK_THEME;
}

const ThemeContext = createContext<ThemeColors>(DARK_THEME);

export function ThemeProvider({
  theme,
  children,
}: {
  theme: Theme;
  children: React.ReactNode;
}) {
  const colors = getThemeColors(theme);
  return React.createElement(ThemeContext.Provider, { value: colors }, children);
}

export function useTheme(): ThemeColors {
  return useContext(ThemeContext);
}

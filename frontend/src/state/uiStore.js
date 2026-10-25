/**
 * Editor preferences that are not part of the diagram: application theme,
 * canvas background and grid. Persisted in the browser so a reload keeps them,
 * and deliberately kept out of the canonical diagram JSON — changing how the
 * canvas looks never rewrites a saved diagram.
 */

import { create } from "zustand";

const THEME_KEY = "sketchcanvas.theme";
const CANVAS_KEY = "sketchcanvas.canvas";
const GRID_KEY = "sketchcanvas.grid";

export const THEMES = ["dark", "light"];

export const CANVAS_BACKGROUNDS = [
  { id: "auto", label: "Match theme" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "white", label: "White" },
  { id: "transparent", label: "Transparent" },
];

const CANVAS_COLORS = {
  dark: "#101722",
  light: "#eef2f8",
  white: "#ffffff",
};

function read(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or a disabled store: the preference still works this session.
  }
}

function initialTheme() {
  return THEMES.includes(read(THEME_KEY, "")) ? read(THEME_KEY, "dark") : "dark";
}

/** Paint the theme on the document so every surface switches at once. */
export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

const theme = initialTheme();
applyTheme(theme);

export const useUiStore = create((set, get) => ({
  theme,
  // "auto" follows the application theme until the user picks a canvas colour.
  canvasBackground: read(CANVAS_KEY, "auto"),
  gridVisible: read(GRID_KEY, "1") === "1",

  setTheme(next) {
    if (!THEMES.includes(next)) return;
    applyTheme(next);
    write(THEME_KEY, next);
    set({ theme: next });
  },

  toggleTheme() {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },

  setCanvasBackground(next) {
    write(CANVAS_KEY, next);
    set({ canvasBackground: next });
  },

  setGridVisible(next) {
    write(GRID_KEY, next ? "1" : "0");
    set({ gridVisible: Boolean(next) });
  },
}));

/** The concrete background colour currently painted behind the diagram. */
export function canvasColor(canvasBackground, theme) {
  if (!canvasBackground || canvasBackground === "auto") {
    return theme === "light" ? CANVAS_COLORS.light : CANVAS_COLORS.dark;
  }
  if (canvasBackground === "transparent") return "transparent";
  return CANVAS_COLORS[canvasBackground] || canvasBackground;
}

/** The colour shape interiors (and hollow arrowheads) sit in front of. */
export function markerBackdrop(canvasBackground, theme) {
  const color = canvasColor(canvasBackground, theme);
  return color === "transparent" ? (theme === "light" ? "#ffffff" : "#101722") : color;
}

/** A grid that stays visible on both light and dark canvases. */
export function gridColor(canvasBackground, theme) {
  const color = canvasColor(canvasBackground, theme);
  if (color === "transparent") return theme === "light" ? "#c9d4e0" : "#243044";
  return luminance(color) > 0.55 ? "#c9d4e0" : "#243044";
}

export function isLightColor(color) {
  return luminance(color) > 0.55;
}

function luminance(color) {
  const hex = String(color || "").replace("#", "");
  if (hex.length !== 6) return 0;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

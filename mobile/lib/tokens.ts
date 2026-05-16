/**
 * Memu Mobile — Design tokens (v3).
 *
 * Two parallel token maps for light & dark. Use `useTokens()` from theme.tsx
 * to get the current map. All existing tokens from the pre-v3 file
 * (mobile/lib/tokens.ts) are preserved as aliases so existing components
 * keep working during transition.
 */

const fonts = {
  ui: 'Inter_500Medium',
  uiRegular: 'Inter_400Regular',
  uiBold: 'Inter_700Bold',
  serif: 'Newsreader_500Medium',
  serifRegular: 'Newsreader_400Regular',
  serifItalic: 'Newsreader_400Regular_Italic',
  mono: 'JetBrainsMono_500Medium',
};

export const lightTokens = {
  name: 'light' as const,
  // Brand
  brand: '#5054B5',
  brandDeep: '#3A3D8F',
  brandSoft: '#EEEDF8',
  brandSofter: '#F6F5FB',
  brandMuted: '#9094FA',
  brandGlow: 'rgba(80, 84, 181, 0.10)',

  // Surfaces
  bg: '#FAF9FB',
  bgWarm: '#F8F6F1',
  surface: '#FFFFFF',
  surfaceAlt: '#FBFAFD',
  sidebar: '#F4F2F8',
  scrim: 'rgba(14, 12, 30, 0.5)',

  // Text
  text: '#0E0C1E',
  text2: '#5B5980',
  text3: '#9994B5',
  textInverse: '#FFFFFF',

  // Lines
  border: '#E8E4F0',
  borderSoft: '#EFEDF4',

  // Semantic
  amber: '#B88843',
  amberBg: 'rgba(184, 136, 67, 0.12)',
  green: '#3A7D5C',
  greenBg: 'rgba(58, 125, 92, 0.10)',
  red: '#A8364B',
  redBg: 'rgba(168, 54, 75, 0.10)',

  // Type
  ...fonts,

  // ── Legacy aliases (for compat with the pre-v3 names) ──
  primary: '#5054B5',
  primaryDim: '#4448A8',
  primaryContainer: '#9094FA',
  onPrimary: '#FBF7FF',
  onSurface: '#0E0C1E',
  onSurfaceVariant: '#5B5980',
  outline: '#9994B5',
  outlineVariant: '#E8E4F0',
};

export const darkTokens: typeof lightTokens = {
  name: 'dark' as const,
  brand: '#A1A5FF',
  brandDeep: '#6B6FE0',
  brandSoft: 'rgba(161, 165, 255, 0.12)',
  brandSofter: 'rgba(161, 165, 255, 0.06)',
  brandMuted: '#8387EB',
  brandGlow: 'rgba(161, 165, 255, 0.18)',

  bg: '#0A0815',
  bgWarm: '#0E0C1E',
  surface: '#15131F',
  surfaceAlt: '#1A1828',
  sidebar: '#0E0C1E',
  scrim: 'rgba(0, 0, 0, 0.7)',

  text: '#EAE7F0',
  text2: '#9994B5',
  text3: '#6E6A88',
  textInverse: '#0E0C1E',

  border: '#252234',
  borderSoft: '#1E1B2A',

  amber: '#E0A85E',
  amberBg: 'rgba(224, 168, 94, 0.14)',
  green: '#6FCE9A',
  greenBg: 'rgba(111, 206, 154, 0.12)',
  red: '#E07A8E',
  redBg: 'rgba(224, 122, 142, 0.14)',

  ...fonts,

  primary: '#A1A5FF',
  primaryDim: '#6B6FE0',
  primaryContainer: '#8387EB',
  onPrimary: '#0E0C1E',
  onSurface: '#EAE7F0',
  onSurfaceVariant: '#9994B5',
  outline: '#6E6A88',
  outlineVariant: '#252234',
};

export type Tokens = typeof lightTokens;

// Spacing — preserved from existing mobile/lib/tokens.ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;

// Type scale
export const typeScale = {
  caption: 11,
  small: 13,
  body: 15,
  large: 18,
  h4: 22,
  h3: 28,
  h2: 34,
  h1: 44,
  display: 56,
};

// Radii
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 9999,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Back-compat re-exports
// ─────────────────────────────────────────────────────────────────────────
//
// The pre-v3 tokens file exported `colors`, `typography`, `shadows`, and
// `motion` as flat static constants. The new v3 design system is theme-
// aware via `useTokens()`, but ~41 files still import these names. We
// keep them as aliases pointing at the light theme so legacy code paths
// compile and render unchanged until each screen is ported. After step 5
// (per-screen ports) these aliases can shrink.
//
// `colors` is intentionally the *light* token map. Components that need
// dark-mode support should migrate to `useTokens()`.

export const colors = {
  // Indigo Sanctuary core (mapped to v3 light brand palette)
  primary: lightTokens.primary,
  primaryDim: lightTokens.primaryDim,
  primaryContainer: lightTokens.primaryContainer,
  primaryFixed: '#9094FA',
  primaryFixedDim: '#8387EB',
  onPrimary: lightTokens.onPrimary,
  onPrimaryContainer: '#080575',

  secondary: '#5B5993',
  secondaryContainer: '#E2DFFF',
  onSecondary: '#FBF7FF',
  onSecondaryContainer: '#4D4B85',

  tertiary: '#645A7A',
  tertiaryContainer: '#E4D7FD',
  tertiaryFixed: '#E4D7FD',
  tertiaryDim: '#584E6D',
  onTertiary: '#FDF7FF',
  onTertiaryContainer: '#534968',

  // Surfaces
  surface: '#F9F9FB',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F2F4F6',
  surfaceContainer: '#ECEEF1',
  surfaceContainerHigh: '#E6E8EC',
  surfaceContainerHighest: '#DFE3E7',
  surfaceVariant: '#DFE3E7',
  surfaceDim: '#D7DADF',
  surfaceBright: '#F9F9FB',
  inverseSurface: '#0C0E10',
  inverseOnSurface: '#9C9D9F',

  // Text
  onSurface: '#2E3336',
  onSurfaceVariant: '#5B6063',
  onBackground: '#2E3336',
  outline: '#777B7F',
  outlineVariant: '#AEB2B6',

  // Semantic
  error: '#A8364B',
  errorContainer: '#F97386',
  errorDim: '#6B0221',
  onError: '#FFF7F7',
  onErrorContainer: '#6E0523',

  success: '#3A7D5C',
  warning: '#B88843',
  onWarning: '#FFFFFF',
  warningContainer: '#FFF7E6',
  onWarningContainer: '#7A5A12',

  // Source semantics
  sourceChat: '#5B5993',
  sourceCalendar: '#5054B5',
  sourceEmail: '#B88843',
  sourceDocument: '#645A7A',
  sourceManual: '#5054B5',

  // Legacy aliases
  accent: '#5054B5',
  accentEnd: '#9094FA',
  accentLight: '#E2DFFF',
  bg: '#F9F9FB',
  surfaceHover: '#F2F4F6',
  text: '#2E3336',
  textSecondary: '#5B6063',
  textMuted: '#777B7F',
  textInverse: '#FBF7FF',
  border: '#AEB2B6',
  borderHover: '#777B7F',
  info: '#5054B5',
} as const;

// Typography — pre-v3 shape preserved.
// `families` references the old Source Sans 3 / Lora font names that were
// loaded in `_layout.tsx`. The v3 root layout now loads Inter + Newsreader +
// JetBrains Mono via `useMemuFonts()`, AND continues to load the legacy
// Source Sans + Lora set, so existing components that hardcoded the old
// family names keep rendering until they migrate to `useTokens()`.
export const typography = {
  fontFamily: 'SourceSans3_400Regular',
  headlineFamily: 'SourceSans3_800ExtraBold',
  sizes: {
    xs: 11,
    sm: 13,
    body: 15,
    lg: 18,
    xl: 22,
    '2xl': 28,
    '3xl': 34,
    '4xl': 44,
    '5xl': 56,
  },
  weights: {
    light: '300' as const,
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },
  tracking: {
    tight: -0.5,
    normal: 0,
    wide: 0.5,
    widest: 2.2,
  },
  families: {
    headline: 'SourceSans3_800ExtraBold',
    headlineLight: 'SourceSans3_300Light',
    headlineMedium: 'SourceSans3_500Medium',
    body: 'SourceSans3_400Regular',
    bodyMedium: 'SourceSans3_500Medium',
    bodyBold: 'SourceSans3_700Bold',
    label: 'SourceSans3_600SemiBold',
    reading: 'Lora_400Regular',
    readingMedium: 'Lora_500Medium',
    readingBold: 'Lora_700Bold',
  },
} as const;

// Elevation — Tonal Morphism. Two tiers.
export const shadows = {
  none: {},
  low: {
    shadowColor: '#2E3336',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  medium: {
    shadowColor: '#2E3336',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
  },
  high: {
    shadowColor: '#5054B5',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.08,
    shadowRadius: 40,
    elevation: 10,
  },
  sm: {
    shadowColor: '#2E3336',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  md: {
    shadowColor: '#2E3336',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
  },
  lg: {
    shadowColor: '#5054B5',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.08,
    shadowRadius: 40,
    elevation: 10,
  },
} as const;

export const motion = {
  pressScale: 0.98,
  breathDuration: 3000,
  fast: 150,
  normal: 250,
  slow: 400,
} as const;

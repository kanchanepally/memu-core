/**
 * Memu Design Tokens — Indigo Sanctuary
 * Source: assets/stitch_family_knowledge_system/indigo_sanctuary/DESIGN.md
 *
 * Principles:
 *   - Slow UX. No 1px borders for sectioning — separation by tonal surface.
 *   - Depth via stacking (surface-container-lowest on surface-container-low).
 *   - AI elements use tertiary (#645A7A) + soft radial glow.
 *   - Errors are muted (#A8364B) not alarm-red.
 *   - Generous padding (24–48px); higher end of the 8px scale.
 */

export const colors = {
  // ---- Indigo Sanctuary core ----
  primary: '#5054B5',            // signature indigo — used sparingly for intent
  primaryDim: '#4448A8',         // pressed states
  primaryContainer: '#9094FA',   // silk gradient endpoint
  primaryFixed: '#9094FA',
  primaryFixedDim: '#8387EB',
  onPrimary: '#FBF7FF',
  onPrimaryContainer: '#080575',

  secondary: '#5B5993',
  secondaryContainer: '#E2DFFF',
  onSecondary: '#FBF7FF',
  onSecondaryContainer: '#4D4B85',

  tertiary: '#645A7A',           // ALL AI elements use this colour
  tertiaryContainer: '#E4D7FD',
  tertiaryFixed: '#E4D7FD',
  tertiaryDim: '#584E6D',
  onTertiary: '#FDF7FF',
  onTertiaryContainer: '#534968',

  // ---- Surface tonal stack (no borders — depth via stacking) ----
  surface: '#F9F9FB',                  // base canvas
  surfaceContainerLowest: '#FFFFFF',   // most prominent interactive cards
  surfaceContainerLow: '#F2F4F6',      // secondary structural areas
  surfaceContainer: '#ECEEF1',
  surfaceContainerHigh: '#E6E8EC',
  surfaceContainerHighest: '#DFE3E7',
  surfaceVariant: '#DFE3E7',
  surfaceDim: '#D7DADF',
  surfaceBright: '#F9F9FB',
  inverseSurface: '#0C0E10',
  inverseOnSurface: '#9C9D9F',

  // ---- Text (on-surface scale) ----
  onSurface: '#2E3336',
  onSurfaceVariant: '#5B6063',
  onBackground: '#2E3336',
  outline: '#777B7F',
  outlineVariant: '#AEB2B6',         // use at 15% opacity for "ghost borders"

  // ---- Semantic (muted, sanctuary-calm) ----
  error: '#A8364B',
  errorContainer: '#F97386',
  errorDim: '#6B0221',
  onError: '#FFF7F7',
  onErrorContainer: '#6E0523',

  success: '#3A7D5C',
  warning: '#B88843',

  // ---- Source semantics (stream card origin) ----
  sourceChat: '#5B5993',
  sourceCalendar: '#5054B5',
  sourceEmail: '#B88843',
  sourceDocument: '#645A7A',
  sourceManual: '#5054B5',

  // ---- Legacy aliases (kept so older screens still compile during migration) ----
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

// ---- Spacing: rhythm of slowness. Move in 8px but favour the high end. ----
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;

// ---- Radius: never 90deg. Cards live in lg (24) or xl (48). ----
export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  xl: 48,
  pill: 9999,
} as const;

// ---- Typography: Manrope headline + Inter body/label ----
export const typography = {
  fontFamily: 'Inter_400Regular',
  headlineFamily: 'Manrope_800ExtraBold',
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
  // Letter spacing: editorial tightness on headlines, widening on labels
  tracking: {
    tight: -0.5,
    normal: 0,
    wide: 0.5,
    widest: 2.2,
  },
  // Family tokens — use these via `fontFamily` directly, not the root one above
  families: {
    headline: 'Manrope_800ExtraBold',
    headlineLight: 'Manrope_300Light',
    headlineMedium: 'Manrope_500Medium',
    body: 'Inter_400Regular',
    bodyMedium: 'Inter_500Medium',
    bodyBold: 'Inter_700Bold',
    label: 'Inter_500Medium',
  },
} as const;

// ---- Elevation: Tonal Morphism. Two tiers. ----
// Low = passive cards. High = floating AI Insight cards only.
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
  // Ambient indigo glow — AI cards, primary modals
  high: {
    shadowColor: '#5054B5',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.08,
    shadowRadius: 40,
    elevation: 10,
  },
  // Legacy aliases
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

// ---- Motion: deliberate, never bouncy ----
export const motion = {
  // Tactile feedback: buttons scale to 0.98 on press, never change colour to muddy grey
  pressScale: 0.98,
  // Skeleton "pulse of life" — slow 3s breath, opacity 0.4 → 1
  breathDuration: 3000,
  // Default transition for colour/opacity shifts
  fast: 150,
  normal: 250,
  slow: 400,
} as const;

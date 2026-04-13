/**
 * Memu Design Tokens — Mobile
 * Source of truth: memu-platform/03-UX-DESIGN-SYSTEM.md
 * System fonts only. Purple accent. No Google Fonts.
 */

export const colors = {
  // Vibrant accents
  accent: '#6D28D9', // Purple from new logo
  accentEnd: '#8B5CF6', 
  accentLight: '#EDE9FE', // Very light lavender

  // Cool backgrounds
  bg: '#FAFAFC', // Clean off-white background
  surface: '#FFFFFF', // Clean white cards
  surfaceHover: '#F5F3FF', // Lavender highlight

  // Text colors (Indigo scale)
  text: '#1E1B4B',
  textSecondary: '#4338CA',
  textMuted: '#94A3B8',
  textInverse: '#ffffff',

  success: '#34A853',
  warning: '#FBBC05',
  error: '#EA4335',
  info: '#4285F4',

  // Source semantics (stream card left border)
  sourceChat: '#10b981',
  sourceCalendar: '#3b82f6',
  sourceEmail: '#f59e0b',
  sourceDocument: '#8b5cf6',
  sourcePhoto: '#ec4899',
  sourceManual: '#94a3b8',

  // Stream card states
  stateSuggested: '#667eea',
  stateConfirmed: '#10b981',
  stateExecuted: '#475569',
  stateDismissed: '#cbd5e1',

  // Borders
  border: '#e2e8f0',
  borderFocus: '#667eea',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

export const typography = {
  // System fonts — no custom font loading needed
  fontFamily: undefined, // React Native uses system font by default
  sizes: {
    xs: 12,
    sm: 14,
    body: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
  },
  weights: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const;

export const shadows = {
  sm: {
    shadowColor: '#4a3f8c',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#4a3f8c',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.20,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

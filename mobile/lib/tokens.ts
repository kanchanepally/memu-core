/**
 * Memu Design Tokens — Mobile
 * Source of truth: memu-platform/03-UX-DESIGN-SYSTEM.md
 * Anytype-inspired: spatial separation over borders, soft wide shadows,
 * cool off-white background with pristine white cards.
 */

export const colors = {
  // Accent (memu purple gradient)
  accent: '#667eea',
  accentEnd: '#764ba2',
  accentLight: '#EDE9FE',

  // Surfaces — cool neutral bg, pristine white cards
  bg: '#F5F5F7',
  surface: '#FFFFFF',
  surfaceHover: '#F5F3FF',

  // Text (indigo scale)
  text: '#1E1B4B',
  textSecondary: '#4338CA',
  textMuted: '#94A3B8',
  textInverse: '#FFFFFF',

  // Very subtle dividers — use sparingly, prefer shadow spacing
  border: '#ECECF0',
  borderHover: '#D9D9E0',

  // Semantic
  success: '#34A853',
  warning: '#FBBC05',
  error: '#EA4335',
  info: '#4285F4',

  // Stream card source accents (used as minimalist dots)
  sourceChat: '#10B981',
  sourceCalendar: '#4285F4',
  sourceEmail: '#FBBC05',
  sourceDocument: '#94A3B8',
  sourceManual: '#667eea',
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
  fontFamily: 'Outfit_400Regular',
  sizes: {
    xs: 12,
    sm: 14,
    body: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 40,
  },
  weights: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const;

// Anytype-style shadows: incredibly soft, wide, layered
export const shadows = {
  none: {},
  sm: {
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  md: {
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  lg: {
    shadowColor: '#1E1B4B',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 6,
  },
} as const;

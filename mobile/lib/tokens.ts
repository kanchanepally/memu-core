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
  bg: baseColors.gray[50],
  surface: baseColors.white,
  surfaceHover: baseColors.gray[100],
  text: baseColors.black,
  textSecondary: baseColors.gray[600],
  textMuted: baseColors.gray[400],
  border: baseColors.gray[100], // Extemely subtle dividers if needed
  borderHover: baseColors.gray[200],
  accent: baseColors.accent.main,
  accentBg: baseColors.accent.light,
  error: '#EF4444',
  success: baseColors.green,
  info: baseColors.blue,
  warning: baseColors.yellow,
  
  // Intelligence card source colors (softened)
  sourceChat: baseColors.green,
  sourceCalendar: baseColors.blue,
  sourceEmail: baseColors.yellow,
  sourceDocument: baseColors.gray[500],
  sourceManual: baseColors.accent.main,
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
  fontFamily: 'Outfit_400Regular', // React Native uses system font by default
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
  none: {},
  sm: {
    shadowColor: baseColors.gray[600],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: baseColors.gray[800],
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  lg: {
    shadowColor: baseColors.gray[900],
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

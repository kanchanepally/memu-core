# Memu Design Tokens Mapping

This document maps the exact 1:1 correspondence between the mobile token definitions in `mobile/lib/tokens.ts` and the PWA CSS custom properties in `src/dashboard/public/css/style.css`.

## Colors

| Category | Mobile Token (`colors.*`) | PWA Token (`var(--*)`) | Hex Value |
| :--- | :--- | :--- | :--- |
| **Primary** | `primary` | `--indigo-primary` | `#5054B5` |
| | `primaryDim` | `--indigo-primary-dim` | `#4448A8` |
| | `primaryContainer` | `--indigo-primary-container` | `#9094FA` |
| | `primaryFixed` | `--indigo-primary-fixed` | `#9094FA` |
| | `primaryFixedDim` | `--indigo-primary-fixed-dim` | `#8387EB` |
| | `onPrimary` | `--indigo-on-primary` | `#FBF7FF` |
| | `onPrimaryContainer` | `--indigo-on-primary-container` | `#080575` |
| **Secondary** | `secondary` | `--indigo-secondary` | `#5B5993` |
| | `secondaryContainer` | `--indigo-secondary-container` | `#E2DFFF` |
| | `onSecondary` | `--indigo-on-secondary` | `#FBF7FF` |
| | `onSecondaryContainer` | `--indigo-on-secondary-container` | `#4D4B85` |
| **Tertiary** | `tertiary` | `--indigo-tertiary` | `#645A7A` |
| | `tertiaryContainer` | `--indigo-tertiary-container` | `#E4D7FD` |
| | `tertiaryFixed` | `--indigo-tertiary-fixed` | `#E4D7FD` |
| | `tertiaryDim` | `--indigo-tertiary-dim` | `#584E6D` |
| | `onTertiary` | `--indigo-on-tertiary` | `#FDF7FF` |
| | `onTertiaryContainer` | `--indigo-on-tertiary-container` | `#534968` |
| **Surface** | `surface` | `--surface` | `#F9F9FB` |
| | `surfaceContainerLowest` | `--surface-lowest` | `#FFFFFF` |
| | `surfaceContainerLow` | `--surface-low` | `#F2F4F6` |
| | `surfaceContainer` | `--surface-container` | `#ECEEF1` |
| | `surfaceContainerHigh` | `--surface-high` | `#E6E8EC` |
| | `surfaceContainerHighest` | `--surface-highest` | `#DFE3E7` |
| | `surfaceVariant` | `--surface-variant` | `#DFE3E7` |
| | `surfaceDim` | `--surface-dim` | `#D7DADF` |
| | `surfaceBright` | `--surface-bright` | `#F9F9FB` |
| | `inverseSurface` | `--inverse-surface` | `#0C0E10` |
| | `inverseOnSurface` | `--inverse-on-surface` | `#9C9D9F` |
| **Text/Outline** | `onSurface` | `--on-surface` | `#2E3336` |
| | `onSurfaceVariant` | `--on-surface-variant` | `#5B6063` |
| | `onBackground` | `--on-background` | `#2E3336` |
| | `outline` | `--outline` | `#777B7F` |
| | `outlineVariant` | `--outline-variant` | `#AEB2B6` |
| **Semantic** | `error` | `--color-error` | `#A8364B` |
| | `errorContainer` | `--color-error-container` | `#F97386` |
| | `errorDim` | `--color-error-dim` | `#6B0221` |
| | `onError` | `--color-on-error` | `#FFF7F7` |
| | `onErrorContainer` | `--color-on-error-container` | `#6E0523` |
| | `success` | `--color-success` | `#3A7D5C` |
| | `warning` | `--color-warning` | `#B88843` |

## Spacing

| Scale Step | Mobile (`spacing.*`) | PWA (`var(--space-*)`) | Pixel Value |
| :--- | :--- | :--- | :--- |
| `xs` | `spacing.xs` | `--space-xs` | `4px` |
| `sm` | `spacing.sm` | `--space-sm` | `8px` |
| `md` | `spacing.md` | `--space-md` | `16px` |
| `lg` | `spacing.lg` | `--space-lg` | `24px` |
| `xl` | `spacing.xl` | `--space-xl` | `32px` |
| `2xl` | `spacing['2xl']` | `--space-2xl` | `48px` |
| `3xl` | `spacing['3xl']` | `--space-3xl` | `64px` |

## Typography

| Use Case | Mobile (`typography.*`) | PWA (`var(--font-*)`) | Value |
| :--- | :--- | :--- | :--- |
| **UI Typeface** | `families.body*`, `families.label` | `--font-ui` | `Source Sans 3` |
| **Reading Typeface** | `families.reading*` | `--font-reading` | `Lora` |

*(Note: Type scale sizes are not explicitly defined as CSS variables in PWA today; they are applied contextually. Phase B/C will ensure they adhere to the mobile 9-step scale: `11, 13, 15, 18, 22, 28, 34, 44, 56`).*

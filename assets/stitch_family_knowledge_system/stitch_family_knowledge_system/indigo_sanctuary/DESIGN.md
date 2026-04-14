# Design System: Indigo Sanctuary

## 1. Overview & Creative North Star: "The Digital Atelier"
This design system moves away from the frantic, high-frequency patterns of modern apps toward a "Slow UX" philosophy. Our Creative North Star is **The Digital Atelier**. We treat the interface not as a screen of pixels, but as a curated desk of physical objects—fine paper, soft slate, and silk-pressed ink.

To break the "template" look, we embrace **Intentional Asymmetry**. Elements should not always be perfectly centered or mirrored; use generous, uneven white space to guide the eye like a high-end editorial magazine. Overlapping elements (e.g., a card slightly bleeding over a section header) create a sense of depth and bespoke craftsmanship that standard grids cannot replicate.

---

## 2. Colors: Tonal Depth
We avoid the "digital blue" and "harsh black" tropes. Instead, we use a palette of deep indigos and warm neutrals to create a sanctuary-like atmosphere.

*   **Primary (`#5054B5`):** Our signature Indigo. Used sparingly for moments of intent.
*   **Surface Hierarchy:**
    *   `surface`: The base canvas (#F9F9FB).
    *   `surface-container-low`: For secondary structural areas.
    *   `surface-container-highest`: For the most prominent interactive cards.
*   **The "No-Line" Rule:** 1px solid borders are strictly prohibited for sectioning. Separation is achieved through background shifts (e.g., a `surface-container-low` card on a `surface` background).
*   **The "Glass & Gradient" Rule:** For floating navigation or modals, use `surface-container-lowest` with a 20px backdrop-blur. 
*   **Signature Textures:** Main CTAs should use a subtle linear gradient from `primary` (#5054B5) to `primary_container` (#9094FA) at a 135-degree angle to provide a "silk" sheen.

---

## 3. Typography: Editorial Authority
The interplay between the geometric softness of Manrope and the functional clarity of Inter creates an authoritative yet approachable voice.

*   **Display & Headlines (Manrope):** Use `display-lg` and `headline-md` for storytelling. Manrope’s variable weights allow us to use `ExtraBold` for impact and `Light` for sophisticated sub-headers.
*   **Body & Titles (Inter):** Inter is our functional workhorse. Use `title-md` for card headings and `body-lg` for long-form content. 
*   **Hierarchy Note:** Always pair a large `display-sm` header with a `label-md` uppercase subtitle to create a "Masthead" feel.

---

## 4. Elevation & Depth: Tactile Morphism
We do not use "drop shadows" in the traditional sense. We use **Tonal Layering** and **Ambient Glows**.

*   **The Layering Principle:** Depth is achieved by stacking. A `surface-container-lowest` card (pure white) placed on a `surface-container-low` background creates a natural lift.
*   **Ambient Shadows (Low, Medium, High):**
    *   **Low:** `shadowColor: #2E3336, shadowOffset: {0, 4}, shadowOpacity: 0.04, shadowRadius: 12`
    *   **High:** `shadowColor: #5054B5, shadowOffset: {0, 20}, shadowOpacity: 0.08, shadowRadius: 40` (Used only for floating "AI Insight" cards).
*   **The "Ghost Border" Fallback:** If a boundary is visually required, use `outline-variant` at **15% opacity**. Never 100%.

---

## 5. Components: Soft & Intentional

### AI Insights (Special Treatment)
AI elements must feel "alive." Use a soft radial gradient background using `tertiary_container` and a subtle 4px "inner glow" using `primary_fixed`. The iconography for AI must always use the `tertiary` color (#645A7A).

### Buttons
*   **Primary:** Corner radius `xl` (3rem), `primary` fill, `on_primary` text.
*   **Secondary:** Corner radius `xl`, `secondary_container` fill, `on_secondary_container` text. No borders.
*   **Tactile Feedback:** On press, scale the button down to 0.98x rather than changing the color to a muddy gray.

### Cards & Containers
*   **Radius:** Always `lg` (2rem/24px) or `xl` (3rem/48px).
*   **Padding:** Double standard spacing (e.g., if a standard app uses 16px, we use 32px).
*   **No Dividers:** Lists within cards are separated by 12px of vertical white space or a subtle `surface-variant` background on alternate rows.

### Loading States: The "Pulse of Life"
Avoid spinning wheels. Use **Skeleton Loaders** that mimic the final layout using `surface-container-high`. The animation should be a slow, 3-second "breath" (opacity fading from 0.4 to 1) rather than a fast shimmer.

---

## 6. Do’s and Don’ts

### Do
*   **Do** use asymmetrical margins (e.g., 32px left, 24px right) to create editorial interest.
*   **Do** allow content to breathe. If a screen feels full, remove an element rather than shrinking the padding.
*   **Do** use `primary_dim` for pressed states to maintain the indigo richness.

### Don't
*   **Don't** use 100% black (#000000). Use `inverse_surface` (#0C0E10) if a dark tone is needed.
*   **Don't** use hard 90-degree corners. Even the smallest chip should have at least an `sm` (0.5rem) radius.
*   **Don't** use "Alert Red" for errors. Use our muted `error` (#A8364B) to keep the user’s heart rate low, even when something goes wrong.

---

## 7. Spacing Scale: The Rhythm of Slowness
We move in increments of 8px, but we favor the higher end of the scale to ensure the "Slow" feel.
*   **Minimal:** 8px (Inner component spacing)
*   **Standard:** 24px (Between related elements)
*   **Sanctuary:** 48px+ (Between major sections or below headers)
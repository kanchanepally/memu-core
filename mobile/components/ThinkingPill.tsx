import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../lib/tokens';

/**
 * The "thinking pill" — Memu's status ticker.
 *
 * Renders as a small pill BELOW the user's most-recent message bubble,
 * ABOVE where Memu's reply will appear. As the SSE stream emits pipeline
 * events, the parent rotates `stage` and `tool` props and the pill
 * morphs in place: icon swaps with a 100ms cross-fade, text variant
 * picked from a small SOUL-voiced catalogue.
 *
 * Privacy positioning: every variant doubles as a proof point. "Filtering
 * through the Twin" makes the privacy layer legible; "Routing through
 * Gemini Flash, UK side" surfaces the geographic decision; "Pulling what
 * I know about Robin" shows Spaces are real, not vapour. Silence kills
 * trust; visibility builds it.
 *
 * `tool` only matters when stage === 'tool_use'; the friendly text picks
 * itself based on which tool fired. Subtle 1.5s pulse animation gives
 * the pill life without being noisy.
 */
export type PillStage =
  | 'thinking'      // optimistic initial pill — fires within 200ms
  | 'twin_check'
  | 'retrieving'
  | 'routing'
  | 'tool_use'
  | 'synthesising'
  | 'slow';         // >15s — switch to "still on it" variants

interface Props {
  stage: PillStage;
  /** Tool name when stage === 'tool_use'. Names match router log entries. */
  tool?: string;
  /** Provider name when stage === 'routing' — for the variant text. */
  provider?: string;
  /** Optional space name when stage === 'tool_use' and tool === 'findSpaces'. */
  spaceName?: string;
}

// Variant catalogues — Memu picks one at render time. Slight variation
// keeps the pill feeling alive rather than templated.
const VARIANTS: Record<Exclude<PillStage, 'tool_use' | 'routing'>, string[]> = {
  thinking: [
    'Thinking…',
    'On it — give me a moment',
    'Working on this',
  ],
  twin_check: [
    'Anonymising before I send this off',
    'Privacy first — swapping names',
    'Filtering through the Twin',
  ],
  retrieving: [
    'Reading your Spaces',
    'Pulling what I know',
    'Checking your notes',
  ],
  synthesising: [
    'Pulling it together',
    'Drafting your reply',
    'Just thinking this through',
  ],
  slow: [
    "Still on it — this one's worth getting right",
    'Almost there — heavier lift than usual',
    'Hang on — chewing through this',
  ],
};

function pickVariant(stage: PillStage, tool?: string, provider?: string, spaceName?: string): string {
  if (stage === 'routing') {
    const friendly = friendlyProvider(provider);
    const variants = [
      `Through ${friendly}, UK side`,
      `Routing to ${friendly}`,
      `${friendly} — UK adequacy lane`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }
  if (stage === 'tool_use') {
    return toolVariant(tool, spaceName);
  }
  const opts = VARIANTS[stage];
  return opts[Math.floor(Math.random() * opts.length)];
}

function friendlyProvider(provider?: string): string {
  switch (provider) {
    case 'anthropic': return 'Claude';
    case 'gemini': return 'Gemini Flash';
    case 'deepseek': return 'DeepSeek';
    case 'ollama': return 'a local model';
    default: return provider || 'the model';
  }
}

function toolVariant(tool?: string, spaceName?: string): string {
  switch (tool) {
    case 'webSearch':
    case 'web_search': {
      const opts = ['Cross-checking the web', 'Looking that up — just a sec', 'Online check — moment'];
      return opts[Math.floor(Math.random() * opts.length)];
    }
    case 'findSpaces': {
      if (spaceName) return `Pulling what I know about ${spaceName}`;
      const opts = ['Searching your Spaces', 'Looking through your notes'];
      return opts[Math.floor(Math.random() * opts.length)];
    }
    case 'addToList':
      return 'Adding to your list';
    case 'createSpace':
      return 'Creating a new Space';
    case 'updateSpace':
      return 'Updating your Space';
    case 'addCalendarEvent':
      return 'Adding to your calendar';
    default:
      return tool ? `Working with ${tool}` : 'Working on this';
  }
}

function pillIcon(stage: PillStage, tool?: string): React.ComponentProps<typeof Ionicons>['name'] {
  if (stage === 'twin_check') return 'shield-checkmark-outline';
  if (stage === 'retrieving') return 'folder-open-outline';
  if (stage === 'routing') return 'navigate-outline';
  if (stage === 'synthesising') return 'create-outline';
  if (stage === 'slow') return 'hourglass-outline';
  if (stage === 'tool_use') {
    switch (tool) {
      case 'webSearch':
      case 'web_search': return 'search-outline';
      case 'findSpaces': return 'folder-open-outline';
      case 'addToList': return 'list-outline';
      case 'createSpace':
      case 'updateSpace': return 'document-text-outline';
      case 'addCalendarEvent': return 'calendar-outline';
      default: return 'cog-outline';
    }
  }
  return 'sparkles-outline';
}

export default function ThinkingPill({ stage, tool, provider, spaceName }: Props) {
  // Memoise variant text per (stage, tool) so it doesn't re-randomise on
  // every re-render — the pill should feel stable until the stage changes.
  const textRef = useRef<string>('');
  const lastKeyRef = useRef<string>('');
  const key = `${stage}:${tool || ''}:${spaceName || ''}`;
  if (key !== lastKeyRef.current) {
    textRef.current = pickVariant(stage, tool, provider, spaceName);
    lastKeyRef.current = key;
  }

  // Cross-fade between stages.
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
      easing: Easing.out(Easing.quad),
    }).start();
  }, [key, opacity]);

  // Subtle pulse — 1.5s loop, gentle opacity wave.
  const pulse = useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
        Animated.timing(pulse, {
          toValue: 0.85,
          duration: 750,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.pill, { opacity: Animated.multiply(opacity, pulse) }]}>
      <Ionicons name={pillIcon(stage, tool)} size={14} color={colors.tertiary} />
      <Text style={styles.text}>{textRef.current}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.tertiary + '40',
    backgroundColor: colors.tertiaryContainer,
    marginLeft: 40, // align under Memu avatar gutter
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  text: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.onTertiaryContainer,
    fontStyle: 'italic',
  },
});

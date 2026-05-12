import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { getNewsFeed, type NewsItem } from '../lib/api';
import { colors, spacing, radius, typography } from '../lib/tokens';

interface Props {
  /** Initial item count to render — "More news" expand goes higher. */
  defaultPerSource?: number;
  expandedPerSource?: number;
}

/**
 * Google Discover-shaped news block for the Today screen.
 *
 * Each item: 64×64 thumbnail (or source-coloured letter tile fallback),
 * headline (2-line truncate), source name · relative time.
 *
 * Tap → expo-web-browser opens the article in an in-app browser dismissable
 * back to Memu — no Safari context switch.
 *
 * Pull-to-refresh on the outer ScrollView; "More news" doubles the per-source
 * cap (3 → 8 by default) and re-fetches.
 */
export default function NewsFeed({ defaultPerSource = 3, expandedPerSource = 8 }: Props) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (perSource: number) => {
    const { data, error: err } = await getNewsFeed(perSource);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    if (data) {
      setItems(data.items);
      setFetchedAt(data.fetchedAt);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(defaultPerSource).finally(() => setLoading(false));
  }, [defaultPerSource, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(expanded ? expandedPerSource : defaultPerSource);
    setRefreshing(false);
  }, [load, expanded, expandedPerSource, defaultPerSource]);

  const onToggleExpand = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    setLoading(true);
    await load(next ? expandedPerSource : defaultPerSource);
    setLoading(false);
  }, [expanded, load, defaultPerSource, expandedPerSource]);

  const openItem = useCallback(async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url, {
        toolbarColor: colors.surface,
        controlsColor: colors.primary,
        dismissButtonStyle: 'close',
      });
    } catch {
      // Falls back gracefully — user can long-press the row's URL elsewhere
      // if we ever surface it. For now, openBrowserAsync rarely fails on
      // a well-formed https URL.
    }
  }, []);

  return (
    <View style={styles.container}>
      {/* Section header — label + refreshed-at + refresh button */}
      <View style={styles.header}>
        <View>
          <Text style={styles.label}>News</Text>
          {fetchedAt ? (
            <Text style={styles.refreshedAt}>Refreshed {formatRelative(fetchedAt)}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={onRefresh}
          disabled={refreshing || loading}
          style={({ pressed }) => [
            styles.refreshBtn,
            (pressed || refreshing) && { opacity: 0.5 },
          ]}
          accessibilityLabel="Refresh news"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="refresh" size={18} color={colors.primary} />
          )}
        </Pressable>
      </View>

      {/* Content */}
      {loading && items.length === 0 ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.tertiary} />
          <Text style={styles.loadingText}>Pulling today's headlines…</Text>
        </View>
      ) : error ? (
        <Pressable style={styles.errorRow} onPress={onRefresh}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.outline} />
          <Text style={styles.errorText}>Couldn't load news. Tap to retry.</Text>
        </Pressable>
      ) : items.length === 0 ? (
        <View style={styles.errorRow}>
          <Ionicons name="newspaper-outline" size={18} color={colors.outline} />
          <Text style={styles.errorText}>
            No news right now. Pick more sources in Settings → Your morning brief.
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          style={styles.scroll}
        >
          {items.map(item => (
            <NewsCard key={item.id} item={item} onPress={() => openItem(item.url)} />
          ))}

          <Pressable
            onPress={onToggleExpand}
            style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.moreLabel}>
              {expanded ? 'Show fewer' : 'More news'}
            </Text>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.primary}
            />
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

interface CardProps {
  item: NewsItem;
  onPress: () => void;
}

function NewsCard({ item, onPress }: CardProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.65 }]}
    >
      {/* Thumbnail or letter-tile fallback */}
      <View style={styles.thumbWrap}>
        {item.thumbnailUrl && !imageError ? (
          <Image
            source={{ uri: item.thumbnailUrl }}
            style={styles.thumb}
            onError={() => setImageError(true)}
            accessible={false}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: sourceTint(item.sourceId) }]}>
            <Text style={styles.thumbFallbackLetter}>
              {item.sourceLabel.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.sourceLabel}
          {item.publishedAt ? ` · ${formatRelative(item.publishedAt)}` : ''}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={14} color={colors.outline} style={styles.chevron} />
    </Pressable>
  );
}

// Source-coloured fallback when no thumbnail. Reasonably distinct per source
// so the letter tile reads at a glance. Values are visually-distinct hues
// inside the Indigo Sanctuary palette range.
function sourceTint(sourceId: string): string {
  switch (sourceId) {
    case 'bbc-news': return '#B91C1C';     // BBC red
    case 'bbc-tech': return '#7C2D12';
    case 'guardian-uk': return '#1E3A8A';  // Guardian blue
    case 'hacker-news': return '#EA580C';  // HN orange
    case 'devon-live': return '#166534';
    case 'plymouth-live': return '#0E7490';
    default: return colors.tertiary;
  }
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return 'just now';
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  label: {
    fontSize: 11,
    fontFamily: typography.families.label,
    color: colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: typography.tracking.widest,
  },
  refreshedAt: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.outline,
    marginTop: 2,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerLowest,
  },
  scroll: {
    maxHeight: 600,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  loadingText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  errorText: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    color: colors.onSurfaceVariant,
  },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: 6,
  },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceContainerLow,
  },
  thumb: {
    width: 64,
    height: 64,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFallbackLetter: {
    fontSize: 24,
    fontFamily: typography.families.headline,
    color: '#fff',
    letterSpacing: typography.tracking.tight,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: typography.sizes.body,
    fontFamily: typography.families.bodyMedium,
    color: colors.onSurface,
    lineHeight: 20,
  },
  meta: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.body,
    color: colors.outline,
  },
  chevron: {
    marginLeft: spacing.xs,
  },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  moreLabel: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.bodyMedium,
    color: colors.primary,
  },
});

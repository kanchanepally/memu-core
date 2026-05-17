import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import Pdf from 'react-native-pdf';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../lib/tokens';
import { useTokens } from '../lib/theme';
import type { Tokens } from '../lib/tokens';
import { getSpaceDocumentSource } from '../lib/api';

interface Props {
  spaceId: string;
  idx?: number;
}

export default function PdfViewer({ spaceId, idx = 0 }: Props) {
  const t = useTokens();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [resolving, setResolving] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    setError(null);
    getSpaceDocumentSource(spaceId, idx).then(src => {
      if (cancelled) return;
      if (!src) {
        setError('Not signed in');
      } else {
        setSource(src);
      }
      setResolving(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Failed to resolve document');
      setResolving(false);
    });
    return () => { cancelled = true; };
  }, [spaceId, idx]);

  if (resolving) {
    return (
      <View style={styles.placeholder}>
        <ActivityIndicator color={t.primary} />
        <Text style={styles.placeholderText}>Loading PDF…</Text>
      </View>
    );
  }
  if (error || !source) {
    return (
      <View style={styles.placeholder}>
        <Ionicons name="alert-circle-outline" size={28} color={t.text3} />
        <Text style={styles.placeholderText}>{error || 'Could not load PDF'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pdf
        source={source}
        style={styles.pdf}
        trustAllCerts={false}
        onLoadComplete={(numberOfPages) => setPageCount(numberOfPages)}
        onPageChanged={(p) => setPage(p)}
        onError={(err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
        }}
        enablePaging
        horizontal={false}
      />
      {pageCount > 0 && (
        <View style={styles.chrome}>
          <Pressable
            onPress={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            style={[styles.navBtn, page <= 1 && styles.navBtnDisabled]}
            accessibilityLabel="Previous page"
          >
            <Ionicons name="chevron-back" size={18} color={page <= 1 ? t.text3 : t.text} />
          </Pressable>
          <Text style={styles.pageLabel}>
            Page {page} of {pageCount}
          </Text>
          <Pressable
            onPress={() => setPage(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
            style={[styles.navBtn, page >= pageCount && styles.navBtnDisabled]}
            accessibilityLabel="Next page"
          >
            <Ionicons name="chevron-forward" size={18} color={page >= pageCount ? t.text3 : t.text} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function makeStyles(t: Tokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.surfaceAlt,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    pdf: {
      flex: 1,
      backgroundColor: t.surfaceAlt,
    },
    placeholder: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xl,
    },
    placeholderText: {
      color: t.text2,
      fontFamily: t.uiRegular,
      fontSize: 14,
    },
    chrome: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
      backgroundColor: t.bg,
    },
    navBtn: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
    },
    navBtnDisabled: {
      opacity: 0.4,
    },
    pageLabel: {
      color: t.text2,
      fontFamily: t.mono,
      fontSize: 13,
    },
  });
}

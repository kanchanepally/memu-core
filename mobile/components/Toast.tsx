import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';

type ToastKind = 'info' | 'error';
interface ToastState {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) return { show: () => {} };
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const idRef = useRef(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    idRef.current += 1;
    const id = idRef.current;
    setToast({ id, message, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setToast((current) => (current?.id === toast.id ? null : current));
      });
    }, 2800);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast, opacity]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrap,
            toast.kind === 'error' ? styles.wrapError : styles.wrapInfo,
            { opacity },
          ]}
        >
          <Ionicons
            name={toast.kind === 'error' ? 'alert-circle-outline' : 'information-circle-outline'}
            size={16}
            color={toast.kind === 'error' ? colors.onErrorContainer : colors.onSurface}
          />
          <Text
            style={[
              styles.text,
              toast.kind === 'error' ? { color: colors.onErrorContainer } : { color: colors.onSurface },
            ]}
            numberOfLines={2}
          >
            {toast.message}
          </Text>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: Platform.OS === 'ios' ? 140 : 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.pill,
    ...shadows.medium,
  },
  wrapInfo: {
    backgroundColor: colors.surfaceContainerLowest,
  },
  wrapError: {
    backgroundColor: colors.errorContainer,
  },
  text: {
    flex: 1,
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.body,
    lineHeight: 20,
  },
});

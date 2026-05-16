import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightTokens, darkTokens, Tokens } from './tokens';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  tokens: Tokens;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  tokens: lightTokens,
  mode: 'system',
  setMode: () => {},
  isDark: false,
});

const STORAGE_KEY = 'memu-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Load stored preference once
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(stored => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setModeState(stored);
      }
    }).catch(() => {});
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  };

  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const tokens = isDark ? darkTokens : lightTokens;

  return (
    <ThemeContext.Provider value={{ tokens, mode, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTokens(): Tokens {
  return useContext(ThemeContext).tokens;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

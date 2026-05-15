# -*- coding: utf-8 -*-
import re

with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\app\\ledger.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Extract LedgerCard function
match = re.search(r'function LedgerCard\(\{ entry \}: \{ entry: LedgerEntry \}\) \{.*?\n\}\n', content, re.DOTALL)
if not match:
    print("Could not find LedgerCard")
    exit(1)

ledger_card_code = match.group(0)

# Replace in ledger.tsx
content = content.replace(ledger_card_code, "")
content = re.sub(r"import\s*\{\s*getLedger,\s*type\s*LedgerEntry\s*\}\s*from\s*'../lib/api';", "import { getLedger, type LedgerEntry } from '../lib/api';\nimport LedgerCard from '../components/LedgerCard';", content)

with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\app\\ledger.tsx", "w", encoding="utf-8") as f:
    f.write(content)

# Now prepare LedgerCard.tsx content
# It needs formatTimestamp, and all the styles related to it.
# Let's extract the styles
style_keys = [
    "card", "cardHeader", "cardHeaderLeft", "channelDot", "cardChannel", "cardTime",
    "block", "blockLabel", "blockText", "blockAI", "blockAILabelRow", "blockAILabel",
    "blockAIText", "translationMap", "mapTitle", "mapRow", "mapReal", "mapAnon",
    "tokenRow", "tokenText", "expandHint", "expandText"
]

styles_extracted = "const styles = StyleSheet.create({\n"
for key in style_keys:
    style_match = re.search(r'^\s*' + key + r':\s*\{.*?\}(?:,|\n)', content, re.MULTILINE | re.DOTALL)
    if style_match:
        styles_extracted += style_match.group(0) + "\n"
styles_extracted += "});\n"

# Remove those styles from ledger.tsx
for key in style_keys:
    content = re.sub(r'^\s*' + key + r':\s*\{.*?\}(?:,|\n)', '', content, flags=re.MULTILINE | re.DOTALL)

with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\app\\ledger.tsx", "w", encoding="utf-8") as f:
    f.write(content)

# We need to construct LedgerCard.tsx
# Import primitives
# Refactor the extracted LedgerCard code to use them
ledger_card_tsx = """import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type LedgerEntry } from '../lib/api';
import { colors, spacing, radius, typography, shadows } from '../lib/tokens';
import { Text } from './ui/Text';
import { Card } from './ui/Card';

export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function LedgerCard({ entry }: { entry: LedgerEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable onPress={() => setExpanded(!expanded)}>
      <Card padding="md" style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.channelDot} />
            <Text variant="ui" size="sm" weight="medium" color="primary" style={styles.cardChannel}>{entry.channel}</Text>
          </View>
          <Text variant="ui" size="xs" color="outline" style={styles.cardTime}>{formatTimestamp(entry.created_at)}</Text>
        </View>

        <View style={styles.block}>
          <Text variant="ui" size="xs" color="outline" style={styles.blockLabel}>You said</Text>
          <Text variant="reading" size="body" color="onSurface" style={styles.blockText}>{entry.content_original}</Text>
        </View>

        <View style={styles.blockAI}>
          <View style={styles.blockAILabelRow}>
            <Ionicons name="eye-outline" size={11} color={colors.tertiary} />
            <Text variant="ui" size="xs" color="tertiary" style={styles.blockAILabel}>Memu sent to cloud AI</Text>
          </View>
          <Text variant="reading" size="body" color="onTertiaryContainer" style={styles.blockAIText}>{entry.content_translated}</Text>
        </View>

        {expanded ? (
          <>
            {entry.entity_translations && entry.entity_translations.length > 0 ? (
              <View style={styles.translationMap}>
                <Text variant="ui" size="xs" color="outline" style={styles.mapTitle}>Names anonymised</Text>
                {entry.entity_translations.map((t, i) => (
                  <View key={i} style={styles.mapRow}>
                    <Text variant="ui" size="sm" color="onSurface" style={styles.mapReal}>{t.real}</Text>
                    <Ionicons name="arrow-forward" size={12} color={colors.outline} />
                    <Text variant="ui" size="sm" color="onSurfaceVariant" style={styles.mapAnon}>{t.anonymous}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.blockAI}>
              <View style={styles.blockAILabelRow}>
                <Ionicons name="cloud-outline" size={11} color={colors.tertiary} />
                <Text variant="ui" size="xs" color="tertiary" style={styles.blockAILabel}>Cloud AI replied (anonymous)</Text>
              </View>
              <Text variant="reading" size="body" color="onTertiaryContainer" style={styles.blockAIText}>{entry.content_response_raw}</Text>
            </View>

            <View style={styles.block}>
              <Text variant="ui" size="xs" color="outline" style={styles.blockLabel}>You saw</Text>
              <Text variant="reading" size="body" color="onSurface" style={styles.blockText}>{entry.content_response_translated}</Text>
            </View>

            {(entry.cloud_tokens_in || entry.cloud_tokens_out) ? (
              <View style={styles.tokenRow}>
                <Text variant="ui" size="xs" color="outline" style={styles.tokenText}>
                  {entry.cloud_tokens_in || 0} tokens in · {entry.cloud_tokens_out || 0} out
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={styles.expandHint}>
          <Text variant="ui" size="xs" color="primary" style={styles.expandText}>
            {expanded ? 'Collapse' : 'See full translation'}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={colors.primary}
          />
        </View>
      </Card>
    </Pressable>
  );
}

""" + styles_extracted

# Clean up fonts from styles_extracted
ledger_card_tsx = re.sub(r'\s*fontFamily\s*:\s*[^,]+,?', '', ledger_card_tsx)
ledger_card_tsx = re.sub(r'\s*fontSize\s*:\s*[^,]+,?', '', ledger_card_tsx)
ledger_card_tsx = re.sub(r'\s*color\s*:\s*[^,]+,?', '', ledger_card_tsx)
ledger_card_tsx = re.sub(r'\s*backgroundColor\s*:\s*colors\.surfaceContainerLowest,?', '', ledger_card_tsx)
ledger_card_tsx = re.sub(r'\s*borderRadius\s*:\s*radius\.lg,?', '', ledger_card_tsx)
ledger_card_tsx = re.sub(r'\s*padding\s*:\s*spacing\.md,?', '', ledger_card_tsx)
ledger_card_tsx = re.sub(r'\s*\.\.\.shadows\.[^,]+,?', '', ledger_card_tsx)

with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\components\\LedgerCard.tsx", "w", encoding="utf-8") as f:
    f.write(ledger_card_tsx)

# Remove formatTimestamp from ledger.tsx
content = re.sub(r'function formatTimestamp\(iso: string\): string \{.*?\n\}\n', '', content, flags=re.DOTALL)
with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\app\\ledger.tsx", "w", encoding="utf-8") as f:
    f.write(content)

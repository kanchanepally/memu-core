import re

with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\app\\(tabs)\\chat.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Fix imports
content = re.sub(r'import\s*\{\s*([^}]*?)\bText\b([^}]*)\s*\}\s*from\s*\'react-native\';', r"import { \1 \2 } from 'react-native';\nimport { Text } from '../../components/ui/Text';", content)
# Clean up multiple commas in react-native import if any
content = re.sub(r',\s*,', ',', content)
content = re.sub(r'\{\s*,', '{', content)

# 2. Let's do targeted replacements for the Text usages so we pass the correct props.
# Separator label
content = re.sub(r'<Text\s+style=\{styles\.separatorLabel\}>', r'<Text variant="ui" size="xs" color="onSurfaceVariant" style={styles.separatorLabel}>', content)
# Briefing eyebrow
content = re.sub(r'<Text\s+style=\{styles\.briefingEyebrow\}>', r'<Text variant="ui" size="xs" color="tertiary" style={styles.briefingEyebrow}>', content)
# Briefing body
content = re.sub(r'<Text\s+selectable=\{true\}\s+style=\{styles\.briefingBody\}>', r'<Text variant="reading" size="body" color="onSurface" selectable={true} style={styles.briefingBody}>', content)
# Timestamp
content = re.sub(r'<Text\s+style=\{styles\.timestamp\}>', r'<Text variant="ui" size="xs" color="outline" style={styles.timestamp}>', content)
# Context Badge
content = re.sub(r'<Text\s+style=\{styles\.contextBadgeText\}>', r'<Text variant="ui" size="xs" color="outline" style={styles.contextBadgeText}>', content)
# Copy Text
content = re.sub(r'<Text\s+style=\{styles\.copyText\}>', r'<Text variant="ui" size="xs" color="primary" style={styles.copyText}>', content)
# Bubble text
content = re.sub(r'<Text\s*selectable=\{true\}\s*style=\{\[\s*styles\.bubbleText,([^\}]+)\]\}\s*>', r'<Text variant="reading" size="body" selectable={true} style={[styles.bubbleText, \1]}>', content)
# Artefact Text
content = re.sub(r'<Text\s+style=\{styles\.artefactText\}\s+numberOfLines=\{1\}>', r'<Text variant="ui" size="sm" weight="medium" color="onTertiaryContainer" numberOfLines={1} style={styles.artefactText}>', content)
# Unsourced Text
content = re.sub(r'<Text\s+style=\{styles\.unsourcedText\}>', r'<Text variant="ui" size="xs" color="onSurfaceVariant" style={styles.unsourcedText}>', content)

with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\app\\(tabs)\\chat.tsx", "w", encoding="utf-8") as f:
    f.write(content)


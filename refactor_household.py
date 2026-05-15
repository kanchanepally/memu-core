import re

with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\app\\household.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Imports
content = re.sub(r"import\s*\{\s*(.*?)\bText\b(.*?)\}\s*from\s*'react-native';", r"import { \1 \2 } from 'react-native';\nimport { Text } from '../components/ui/Text';\nimport { Card } from '../components/ui/Card';", content)
content = re.sub(r',\s*,', ',', content)
content = re.sub(r'\{\s*,', '{', content)

# 2. Refactor member list item
# Instead of <Pressable ... style={styles.card} ...> <View ...>
# We will change it to <Pressable ... onPress={...}> <Card style={styles.card}>
content = re.sub(r'<Pressable\s+key=\{m\.id\}\s+style=\{styles\.card\}\s+onPress=\{([^}]+)\}>', r'<Pressable key={m.id} onPress={\1}>\n                <Card padding="md" style={styles.card}>', content)
content = re.sub(r'(</View>\s*</View>\s*)</Pressable>', r'\1</Card>\n              </Pressable>', content)

# 3. Use Text primitive for Member Name and Webid
content = re.sub(r'<Text\s+style=\{styles\.memberName\}>', r'<Text variant="ui" size="body" weight="medium" color="onSurface" style={styles.memberName}>', content)
content = re.sub(r'<Text\s+style=\{styles\.memberWebid\}\s+numberOfLines=\{1\}>', r'<Text variant="ui" size="sm" color="onSurfaceVariant" numberOfLines={1} style={styles.memberWebid}>', content)
content = re.sub(r'<Text\s+style=\{styles\.gracePreview\}>', r'<Text variant="ui" size="xs" color="warning" style={styles.gracePreview}>', content)

# 4. Clean up styles.card
def clean_card_style(match):
    body = match.group(0)
    body = re.sub(r'\s*backgroundColor\s*:\s*[^,]+,', '', body)
    body = re.sub(r'\s*borderRadius\s*:\s*[^,]+,', '', body)
    body = re.sub(r'\s*padding\s*:\s*[^,]+,', '', body)
    body = re.sub(r'\s*\.\.\.shadows\.[^,]+,', '', body)
    return body

content = re.sub(r'card\s*:\s*\{[^}]+\}', clean_card_style, content)

# Clean up styles for text
def clean_text_style(match):
    body = match.group(0)
    body = re.sub(r'\s*fontSize\s*:\s*[^,]+,', '', body)
    body = re.sub(r'\s*fontFamily\s*:\s*[^,]+,', '', body)
    body = re.sub(r'\s*color\s*:\s*[^,]+,', '', body)
    return body

content = re.sub(r'memberName\s*:\s*\{[^}]+\}', clean_text_style, content)
content = re.sub(r'memberWebid\s*:\s*\{[^}]+\}', clean_text_style, content)
content = re.sub(r'gracePreview\s*:\s*\{[^}]+\}', clean_text_style, content)

with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\app\\household.tsx", "w", encoding="utf-8") as f:
    f.write(content)

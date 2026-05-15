import re

with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\app\\(tabs)\\chat.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# We want to remove fontSize, fontFamily, color from specific style objects
targets = [
    "separatorLabel", "briefingEyebrow", "briefingBody", "timestamp",
    "contextBadgeText", "copyText", "bubbleText", "artefactText", "unsourcedText"
]

for t in targets:
    # Match the block:   target: { ... },
    pattern = r'(' + t + r'\s*:\s*\{)([^}]*?)(\})'
    def clean_block(match):
        pre = match.group(1)
        body = match.group(2)
        post = match.group(3)
        # Remove fontSize, fontFamily, color
        body = re.sub(r'\s*fontSize\s*:\s*[^,]+,?', '', body)
        body = re.sub(r'\s*fontFamily\s*:\s*[^,]+,?', '', body)
        body = re.sub(r'\s*color\s*:\s*[^,]+,?', '', body)
        return pre + body + post
    content = re.sub(pattern, clean_block, content)

with open("c:\\Users\\Lenovo\\Code\\memu-core\\mobile\\app\\(tabs)\\chat.tsx", "w", encoding="utf-8") as f:
    f.write(content)


import re

with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\css\\style.css", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add warning tokens to :root
root_tokens = """  --color-success: #3A7D5C;
  --color-warning: #B88843;
  --color-on-warning: #FFFFFF;
  --color-warning-container: #FFF7E6;
  --color-on-warning-container: #7A5A12;"""
content = re.sub(r'--color-success:\s*#3A7D5C;', root_tokens, content)

# 2. Map existing yellow/orange hardcoded classes to warning tokens
# .bubble.bubble-error
content = re.sub(r'color:\s*#7A5A12', 'color: var(--color-on-warning-container)', content)
content = re.sub(r'border:\s*1px solid #E6B847', 'border: 1px solid var(--color-warning)', content)
content = re.sub(r'background:\s*#FFF7E6', 'background: var(--color-warning-container)', content)
# .nudge-bubble.nudge-tone-attention
content = re.sub(r'border-left-color:\s*#C26A00', 'border-left-color: var(--color-warning)', content)
content = re.sub(r'color:\s*#C26A00', 'color: var(--color-on-warning-container)', content)

# 3. Typography snapping
# 9px, 10px -> var(--font-size-xs)
content = re.sub(r'font-size:\s*(?:9|10)px;', 'font-size: var(--font-size-xs);', content)
# 11px -> xs (handled in general replace later, or just do it here to be safe)
content = re.sub(r'font-size:\s*11px;', 'font-size: var(--font-size-xs);', content)
# 12px, 13px, 14px -> var(--font-size-sm)
content = re.sub(r'font-size:\s*(?:12|13|14)px;', 'font-size: var(--font-size-sm);', content)
# 15px, 16px, 17px -> var(--font-size-body)
content = re.sub(r'font-size:\s*(?:15|16|17)px;', 'font-size: var(--font-size-body);', content)
# 18px, 20px -> var(--font-size-lg)
content = re.sub(r'font-size:\s*(?:18|20)px;', 'font-size: var(--font-size-lg);', content)
# 22px -> var(--font-size-xl)
content = re.sub(r'font-size:\s*22px;', 'font-size: var(--font-size-xl);', content)
# 26px, 28px, 30px -> var(--font-size-2xl)
content = re.sub(r'font-size:\s*(?:26|28|30)px;', 'font-size: var(--font-size-2xl);', content)
# 34px -> var(--font-size-3xl)
content = re.sub(r'font-size:\s*34px;', 'font-size: var(--font-size-3xl);', content)
# 44px -> var(--font-size-4xl)
content = re.sub(r'font-size:\s*44px;', 'font-size: var(--font-size-4xl);', content)
# 56px -> var(--font-size-5xl)
content = re.sub(r'font-size:\s*56px;', 'font-size: var(--font-size-5xl);', content)

# 4. Spacing / Layout mapping (margins, paddings, gaps, top, bottom, left, right, border-radius)
# We will ONLY replace px values in specific properties. Structural widths/heights, max-widths, etc are ignored.
spacing_map = {
    # 4px -> xs
    "2px": "var(--space-xs)", "3px": "var(--space-xs)", "4px": "var(--space-xs)", "5px": "var(--space-xs)", "6px": "var(--space-xs)",
    # 8px -> sm
    "7px": "var(--space-sm)", "8px": "var(--space-sm)", "10px": "var(--space-sm)",
    # 16px -> md
    "12px": "var(--space-md)", "14px": "var(--space-md)", "16px": "var(--space-md)",
    # 24px -> lg
    "20px": "var(--space-lg)", "24px": "var(--space-lg)",
    # 32px -> xl
    "32px": "var(--space-xl)",
    # 48px -> 2xl
    "48px": "var(--space-2xl)",
    # 64px -> 3xl
    "64px": "var(--space-3xl)"
}
radius_map = {
    "8px": "var(--radius-sm)",
    "16px": "var(--radius-md)",
    "24px": "var(--radius-lg)",
    "32px": "var(--radius-xl)",
    "999px": "var(--radius-pill)",
    "9999px": "var(--radius-pill)"
}

def replace_spacing(match):
    prop = match.group(1)
    val = match.group(2)
    # Don't touch widths, heights, min-width, max-width, line-height, letter-spacing, transform
    if prop in ["width", "height", "min-width", "max-width", "min-height", "max-height", "line-height", "letter-spacing", "transform", "box-shadow"]:
        return match.group(0)
    
    # Split the value by spaces to handle multiple values like "padding: 18px 20px"
    parts = val.split()
    new_parts = []
    for p in parts:
        if prop == "border-radius" and p in radius_map:
            new_parts.append(radius_map[p])
        elif p in spacing_map and prop != "border-radius":
            new_parts.append(spacing_map[p])
        else:
            new_parts.append(p)
    return f"{prop}: {' '.join(new_parts)};"

content = re.sub(r'([a-z-]+)\s*:\s*([^;]+);', replace_spacing, content)

# 5. Box shadows
content = content.replace('0 4px 12px rgba(46, 51, 54, 0.04)', 'var(--shadow-sm)')
content = content.replace('0 8px 24px rgba(46, 51, 54, 0.06)', 'var(--shadow-md)')
content = content.replace('0 20px 40px rgba(80, 84, 181, 0.08)', 'var(--shadow-lg)')

# 6. Colors
content = re.sub(r'color:\s*#fff\b', 'color: var(--color-on-primary)', content)
# .event-card-conflict -> background: #fffafa -> error-container
content = re.sub(r'background:\s*#fffafa\b', 'background: var(--color-error-container)', content)
# .anonymised-block -> background: #f0f0ff -> surface-container-highest
content = re.sub(r'background:\s*#f0f0ff\b', 'background: var(--surface-container-highest)', content)
# .toast-error custom colors -> mapped to standard tokens
content = re.sub(r'background:\s*#fef2f2\b', 'background: var(--color-error-container)', content)
content = re.sub(r'border:\s*1px solid #fecaca\b', 'border: 1px solid var(--color-error)', content)
content = re.sub(r'color:\s*#dc2626\b', 'color: var(--color-on-error-container)', content)
# .toast-success
content = re.sub(r'background:\s*#f0fdf4\b', 'background: var(--color-success-container)', content)
content = re.sub(r'border:\s*1px solid #bbf7d0\b', 'border: 1px solid var(--color-success)', content)
content = re.sub(r'color:\s*#16a34a\b', 'color: var(--color-on-success-container)', content)

# Write it out
with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\css\\style.css", "w", encoding="utf-8") as f:
    f.write(content)

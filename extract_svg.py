import re
import uuid

with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\dashboard.html", "r", encoding="utf-8") as f:
    content = f.read()

# Find all <svg ...>...</svg> blocks
svg_pattern = re.compile(r'<svg\b[^>]*>.*?</svg>', re.IGNORECASE | re.DOTALL)
svgs = svg_pattern.findall(content)

# We will collect unique SVGs and replace them
sprite_defs = []
svg_map = {} # path_content -> id

def normalize_svg_content(inner_content):
    # Normalize path formatting slightly if needed, but mainly we rely on the stroke properties in the <svg> tag.
    # We will strip out inline stroke="currentColor" etc. from inner tags if they exist.
    return inner_content

counter = 1
for svg in svgs:
    # If it's already a <use>, skip
    if '<use ' in svg:
        continue
    
    # Extract inner content
    inner_match = re.search(r'<svg[^>]*>(.*?)</svg>', svg, re.IGNORECASE | re.DOTALL)
    if not inner_match:
        continue
    inner = inner_match.group(1).strip()
    
    # We use inner content as the unique key
    if inner not in svg_map:
        icon_id = f"icon-{counter}"
        counter += 1
        svg_map[inner] = icon_id
        # Build symbol
        symbol = f'  <symbol id="{icon_id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">\n    {inner}\n  </symbol>'
        sprite_defs.append(symbol)

# Now replace in content
def replace_svg(match):
    full = match.group(0)
    if '<use ' in full:
        return full
    inner_match = re.search(r'<svg[^>]*>(.*?)</svg>', full, re.IGNORECASE | re.DOTALL)
    if not inner_match:
        return full
    inner = inner_match.group(1).strip()
    
    if inner in svg_map:
        icon_id = svg_map[inner]
        
        # Extract class if any
        class_match = re.search(r'class="([^"]+)"', full)
        classes = class_match.group(1) if class_match else ""
        if "icon" not in classes:
            classes = (classes + " icon").strip()
            
        return f'<svg class="{classes}"><use href="#{icon_id}"></use></svg>'
    return full

new_content = svg_pattern.sub(replace_svg, content)

# Inject sprite at the top of <body>
sprite_html = f"""
<!-- SVG Sprite: Normalized to match Ionicons-outline visual characteristics -->
<!-- Ionicons outline base: 512x512 viewBox, 32px stroke, round caps/joins -->
<!-- Equivalent in 24x24 viewBox: 1.5px stroke, round caps/joins -->
<svg style="display: none;">
  <defs>
{chr(10).join(sprite_defs)}
  </defs>
</svg>
"""

new_content = new_content.replace('<body>', '<body>' + sprite_html)

with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\dashboard.html", "w", encoding="utf-8") as f:
    f.write(new_content)

print(f"Extracted {len(sprite_defs)} unique SVGs into sprite.")


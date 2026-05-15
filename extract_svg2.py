import re

with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\dashboard.html", "r", encoding="utf-8") as f:
    content = f.read()

# Find all <svg ...>...</svg> blocks
svg_pattern = re.compile(r'<svg\b([^>]*)>(.*?)</svg>', re.IGNORECASE | re.DOTALL)

sprite_defs = []
svg_map = {} # path_content -> id
counter = 1

def process_svg(match):
    global counter
    attrs = match.group(1)
    inner = match.group(2).strip()
    
    # If it's already a <use>, skip
    if '<use ' in inner:
        return match.group(0)
    
    # Extract structural info for the symbol
    # We want to ignore visual stylings on the original tags because they will be standardized
    if inner not in svg_map:
        icon_id = f"icon-{counter}"
        counter += 1
        svg_map[inner] = icon_id
        # Build symbol: enforcing Ionicons 1.5px stroke weight, round cap/join on a 24x24 box
        symbol = f'  <symbol id="{icon_id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">\n    {inner}\n  </symbol>'
        sprite_defs.append(symbol)
    
    icon_id = svg_map[inner]
    
    # Preserve width, height, and class from original <svg>
    w_match = re.search(r'\bwidth="([^"]+)"', attrs)
    h_match = re.search(r'\bheight="([^"]+)"', attrs)
    c_match = re.search(r'\bclass="([^"]+)"', attrs)
    
    new_attrs = []
    if c_match:
        classes = c_match.group(1)
        if "icon" not in classes:
            classes = (classes + " icon").strip()
        new_attrs.append(f'class="{classes}"')
    else:
        new_attrs.append('class="icon"')
        
    if w_match:
        new_attrs.append(f'width="{w_match.group(1)}"')
    if h_match:
        new_attrs.append(f'height="{h_match.group(1)}"')
        
    # Also grab style attribute if any
    s_match = re.search(r'\bstyle="([^"]+)"', attrs)
    if s_match:
        new_attrs.append(f'style="{s_match.group(1)}"')

    return f'<svg {" ".join(new_attrs)}><use href="#{icon_id}"></use></svg>'

new_content = svg_pattern.sub(process_svg, content)

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


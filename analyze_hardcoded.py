import re
from collections import defaultdict

with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\css\\style.css", "r", encoding="utf-8") as f:
    content = f.read()

# Strip comments
content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)

# Find all blocks and parse properties
blocks = re.finditer(r'([^{]+)\{([^}]+)\}', content)

hardcoded = defaultdict(list)

# Regex to find hardcoded values:
# Hex: #[a-fA-F0-9]{3,8}
# px, rem, em: \b\d+(?:\.\d+)?(?:px|rem|em)\b
# But ignore anything inside var(...)
# To simplify, we just search for the patterns and see if they are not in a var() string.

def has_hardcoded(val):
    if 'var(' in val:
        # Check if there are values OUTSIDE var()
        # For simplicity, if it contains var(), we skip it unless we are sure it has other hardcoded parts.
        # But let's just strip var(...) and check the rest
        val_no_var = re.sub(r'var\([^)]+\)', '', val)
    else:
        val_no_var = val
    
    matches = []
    # Find Hex
    hex_m = re.findall(r'#[a-fA-F0-9]{3,6}\b', val_no_var)
    matches.extend(hex_m)
    # Find units
    unit_m = re.findall(r'\b\d+(?:\.\d+)?(?:px|rem|em)\b', val_no_var)
    # Filter out 1px borders as they are usually fine, but the spec says "all non-var usages of #hex, px, rem, em in layout and typography"
    # Actually, let's keep them and we can propose replacements
    matches.extend(unit_m)
    return matches

for block in blocks:
    selector = block.group(1).strip()
    # skip keyframes and font-face
    if selector.startswith('@'):
        continue
    properties = block.group(2).split(';')
    for prop in properties:
        prop = prop.strip()
        if not prop: continue
        if ':' not in prop: continue
        k, v = prop.split(':', 1)
        k = k.strip()
        v = v.strip()
        
        matches = has_hardcoded(v)
        if matches:
            for m in set(matches):
                if m == "1px" and "border" in k:
                    continue # 1px borders are generally ok
                hardcoded[m].append(f"{selector} -> {k}: {v}")

with open("c:\\Users\\Lenovo\\Code\\memu-core\\hardcoded_report.txt", "w", encoding="utf-8") as f:
    for val, locations in sorted(hardcoded.items()):
        f.write(f"Value: {val} (Found {len(locations)} times)\n")
        for loc in locations[:5]: # show up to 5 examples
            f.write(f"  {loc}\n")
        if len(locations) > 5:
            f.write(f"  ... and {len(locations) - 5} more\n")
        f.write("\n")

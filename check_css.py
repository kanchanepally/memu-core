import re

with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\css\\style.css", "r", encoding="utf-8") as f:
    content = f.read()

# Remove comments
content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)

open_braces = content.count('{')
close_braces = content.count('}')

print(f"Open braces: {open_braces}")
print(f"Close braces: {close_braces}")

# Also let's check for any missing semicolons before closing braces
# Actually CSS allows omitting the last semicolon before a closing brace.

# Check for something like `font-family: 'Source Sans 3', sans-serif` without semicolon?
lines = content.split('\n')
for i, line in enumerate(lines):
    # If the line ends with a property value without a semicolon, and not a block start or empty
    line = line.strip()
    if line and not line.endswith(';') and not line.endswith('{') and not line.endswith('}') and ':' in line:
        if not line.startswith('@'):
            print(f"Line {i+1} has no ending semicolon: {line}")


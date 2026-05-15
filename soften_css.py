import re

with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\css\\style.css", "r", encoding="utf-8") as f:
    content = f.read()

# Replace border with border-dim for a softer default
content = content.replace("border: 1px solid var(--border);", "border: 1px solid var(--color-outline-variant);")
content = content.replace("border: 1px solid var(--border-color, #e4e6ef);", "border: 1px solid var(--color-outline-variant);")
content = content.replace("border: 1px solid rgba(80, 84, 181, 0.22);", "border: 1px solid var(--color-outline-variant);")
content = content.replace("border: 1px solid rgba(80, 84, 181, 0.14);", "border: 1px solid var(--color-outline-variant);")
content = content.replace("box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1)", "box-shadow: var(--shadow-sm)")
content = content.replace("box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1)", "box-shadow: var(--shadow-md)")

with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\css\\style.css", "w", encoding="utf-8") as f:
    f.write(content)

import re

with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\css\\style.css", "r", encoding="utf-8") as f:
    content = f.read()

content = re.sub(
    r'\.banner-error\s*\{[^}]+\}',
    '.banner-error {\n  display: flex;\n  align-items: center;\n  gap: var(--space-sm);\n  background: var(--color-error-container);\n  border: 1px solid var(--color-error);\n  border-radius: var(--radius-md);\n  padding: var(--space-md);\n  margin-bottom: var(--space-md);\n  font-size: var(--font-size-sm);\n  color: var(--color-on-error-container);\n}',
    content
)

content = re.sub(
    r'\.banner-success\s*\{[^}]+\}',
    '.banner-success {\n  display: flex;\n  align-items: center;\n  gap: var(--space-sm);\n  background: var(--color-success-container);\n  border: 1px solid var(--color-success);\n  border-radius: var(--radius-md);\n  padding: var(--space-md);\n  margin-bottom: var(--space-md);\n  font-size: var(--font-size-sm);\n  color: var(--color-on-success-container);\n}',
    content
)

with open("c:\\Users\\Lenovo\\Code\\memu-core\\src\\dashboard\\public\\css\\style.css", "w", encoding="utf-8") as f:
    f.write(content)

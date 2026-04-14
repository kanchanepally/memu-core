/**
 * Strip markdown formatting for preview text.
 * Removes headings, bold/italic markers, links, list bullets, code ticks,
 * and blockquotes — preserving the underlying prose.
 */
export function stripMarkdown(md: string): string {
  if (!md) return '';
  return md
    // Remove code fences (keep inner text)
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Images ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Headings: strip leading #
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    // Blockquotes
    .replace(/^\s{0,3}>\s?/gm, '')
    // Unordered list bullets
    .replace(/^\s*[-*+]\s+/gm, '')
    // Ordered list markers
    .replace(/^\s*\d+\.\s+/gm, '')
    // Bold + italic: ***x*** / ___x___
    .replace(/(\*\*\*|___)(.*?)\1/g, '$2')
    // Bold: **x** / __x__
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    // Italic: *x* / _x_
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Strikethrough
    .replace(/~~(.*?)~~/g, '$1')
    // Horizontal rules
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    // Collapse excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

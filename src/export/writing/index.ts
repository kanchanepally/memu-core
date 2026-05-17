/**
 * BS3 Phase W6 — target registry and dispatcher.
 *
 * One entry point: `renderExport(target, context)` looks up the
 * target's pure renderer and returns the rendered ExportResult.
 *
 * Every renderer is pure — no DB, no LLM, no clock. The
 * DB-touching loader (src/api/writingSpaceExport.ts) is responsible
 * for assembling the RenderContext.
 */

import { renderMarkdown } from './markdown';
import { renderSubstack } from './substack';
import { renderDocx } from './docx';
import { renderLatex } from './latex';
import { renderPandoc } from './pandoc';
import { renderBibtex } from './bibtex';
import { renderPrint } from './print';
import {
  type ExportTarget,
  type ExportResult,
  type RenderContext,
  EXPORT_TARGETS,
  isExportTarget,
} from './types';

type RendererFn = (context: RenderContext) => ExportResult;

const REGISTRY: Record<ExportTarget, RendererFn> = {
  markdown: renderMarkdown,
  substack: renderSubstack,
  docx: renderDocx,
  latex: renderLatex,
  pandoc: renderPandoc,
  bibtex: renderBibtex,
  print: renderPrint,
};

export function renderExport(target: ExportTarget, context: RenderContext): ExportResult {
  const renderer = REGISTRY[target];
  if (!renderer) {
    throw new Error(`unknown export target: ${target}`);
  }
  return renderer(context);
}

export { EXPORT_TARGETS, isExportTarget };
export type { ExportTarget, ExportResult, RenderContext } from './types';
export type {
  CitedArtefact,
  CitationWithArtefact,
  CitationFormat,
} from './types';
export {
  computeSurroundingHash,
  detectDriftedCitations,
  buildCitationKey,
  substitutePlaceholders,
  safeFilename,
  DELETED_ARTEFACT_LABEL,
} from './types';

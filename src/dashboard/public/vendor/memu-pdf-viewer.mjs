/**
 * Build Spec 2 Phase Z — Story Z.3 client-side PDF viewer.
 *
 * Renders a PDF inline via pdf.js v4 with a selectable text layer over
 * each page's canvas. Loaded as an ES module (pdf.js v4 dropped UMD)
 * and exposed to the rest of the dashboard via window.MemuPdfViewer so
 * the classic <script> inline JS can call it.
 *
 * Scope deliberately minimal:
 *   - Continuous scroll, one canvas per page
 *   - Page numbers shown above each page
 *   - Text-selectable via pdf.js's TextLayer
 *   - Cancellable: returns a handle whose .destroy() aborts in-flight
 *     page renders and removes the DOM (called when the Space view is
 *     closed or navigated away)
 *
 * Deferred to follow-ups:
 *   - Contents panel (PDF outlines extracted via pdfDoc.getOutline())
 *   - Stable passage-id derivation from (file_hash, page, char_range)
 *     so a selection can address a passage (Z.2 equivalent for PDFs —
 *     needed by the active-reading toolbar in Phase R3)
 *   - Page-thumbnail rail, "Convert to markdown" action, highlight
 *     overlay (R3), search-in-PDF
 */

import { GlobalWorkerOptions, getDocument } from '/vendor/pdf.min.mjs';

// The worker runs PDF parsing off the main thread. Point pdf.js at our
// vendored worker bundle so the network never reaches outside /vendor/.
GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';

// Devicepixelratio-aware rendering. 1.5x DPR gives crisp text on retina
// without ballooning canvas memory on 4K screens.
function effectiveScale(baseScale) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return baseScale * dpr;
}

/**
 * Render `pdfUrl` into `container`. Returns a handle with .destroy().
 *
 * The container is wiped on entry — the viewer takes ownership. Pages
 * render sequentially (not all in parallel) to keep memory bounded on
 * large documents; a typical 40-page paper renders progressively in
 * 2–4s on a modern desktop.
 */
export async function renderPdfInto(pdfUrl, container) {
  if (!container) throw new Error('renderPdfInto: container is required');

  container.innerHTML = '';
  container.classList.add('pdf-viewer');

  // Loading affordance while pdf.js fetches + parses the document.
  const loading = document.createElement('div');
  loading.className = 'pdf-loading';
  loading.textContent = 'Loading PDF…';
  container.appendChild(loading);

  let cancelled = false;
  const renderTasks = new Set();
  const handle = {
    destroy() {
      cancelled = true;
      for (const t of renderTasks) {
        try { t.cancel(); } catch { /* swallow — already-completed renders throw on cancel */ }
      }
      renderTasks.clear();
      try { container.innerHTML = ''; container.classList.remove('pdf-viewer'); } catch { /* fine */ }
    },
  };

  let pdfDoc;
  try {
    pdfDoc = await getDocument({ url: pdfUrl }).promise;
  } catch (err) {
    if (cancelled) return handle;
    loading.textContent = `Couldn't load the PDF: ${err && err.message ? err.message : err}`;
    loading.classList.add('pdf-error');
    return handle;
  }

  if (cancelled) return handle;
  loading.remove();

  // Width target — the container's content area minus a small margin
  // so the canvas doesn't crash into the scrollbar. Computed once at
  // start; pdf.js viewport math handles per-page width variation.
  const targetWidth = Math.max(320, container.clientWidth - 8);

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    if (cancelled) break;
    let page;
    try {
      page = await pdfDoc.getPage(pageNum);
    } catch (err) {
      if (cancelled) break;
      console.warn('[pdf] getPage failed for page', pageNum, err);
      continue;
    }

    // baseScale = targetWidth / page's native width. The page renders
    // at fit-to-container width; user can zoom via browser pinch /
    // ctrl-+ if they need more detail.
    const baseViewport = page.getViewport({ scale: 1 });
    const baseScale = targetWidth / baseViewport.width;
    const renderViewport = page.getViewport({ scale: effectiveScale(baseScale) });
    const cssViewport = page.getViewport({ scale: baseScale });

    const pageEl = document.createElement('div');
    pageEl.className = 'pdf-page';
    pageEl.dataset.pageNumber = String(pageNum);
    pageEl.style.width = `${cssViewport.width}px`;
    pageEl.style.height = `${cssViewport.height}px`;

    const label = document.createElement('div');
    label.className = 'pdf-page-label';
    label.textContent = `Page ${pageNum} / ${pdfDoc.numPages}`;

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.width = renderViewport.width;
    canvas.height = renderViewport.height;
    canvas.style.width = `${cssViewport.width}px`;
    canvas.style.height = `${cssViewport.height}px`;

    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'pdf-text-layer';
    textLayerDiv.style.width = `${cssViewport.width}px`;
    textLayerDiv.style.height = `${cssViewport.height}px`;
    // pdf.js's TextLayer reads --scale-factor from the container to
    // size text spans to match the canvas. Without this every span
    // shrinks to nothing and selection becomes impossible.
    textLayerDiv.style.setProperty('--scale-factor', String(baseScale));

    container.appendChild(pageEl);
    pageEl.appendChild(label);
    pageEl.appendChild(canvas);
    pageEl.appendChild(textLayerDiv);

    const ctx = canvas.getContext('2d');
    const renderTask = page.render({ canvasContext: ctx, viewport: renderViewport });
    renderTasks.add(renderTask);
    try {
      await renderTask.promise;
    } catch (err) {
      if (cancelled) break;
      // Render cancellation reaches here too — swallow and continue.
      if (err && err.name !== 'RenderingCancelledException') {
        console.warn('[pdf] page render failed', pageNum, err);
      }
      continue;
    } finally {
      renderTasks.delete(renderTask);
    }
    if (cancelled) break;

    // Text layer: pdf.js v4 exposes TextLayer as a class; we instantiate
    // it per page with the text content + the CSS-pixel viewport so the
    // spans align with the canvas underneath.
    try {
      const textContent = await page.getTextContent();
      if (cancelled) break;
      // pdf.js v4: TextLayer is the modern API. Pre-v4 used renderTextLayer().
      const { TextLayer } = await import('/vendor/pdf.min.mjs');
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport: cssViewport,
      });
      await textLayer.render();
    } catch (err) {
      if (cancelled) break;
      console.warn('[pdf] text layer build failed for page', pageNum, err);
      // Non-fatal — canvas is rendered, selection just won't work on this page.
    }
  }

  return handle;
}

// Expose to the classic-script side of dashboard.html.
window.MemuPdfViewer = { renderPdfInto };

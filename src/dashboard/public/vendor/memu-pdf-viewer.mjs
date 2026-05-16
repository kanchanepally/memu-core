/**
 * Build Spec 2 Phase Z — Story Z.3 client-side PDF viewer.
 *
 * Renders a PDF inline via pdf.js v4 with a selectable text layer over
 * each page's canvas. Loaded as an ES module (pdf.js v4 dropped UMD)
 * and exposed to the rest of the dashboard via window.MemuPdfViewer so
 * the classic <script> inline JS can call it.
 *
 * Scope:
 *   - Continuous scroll, one canvas per page
 *   - Page numbers shown above each page (`data-page-number` attr too)
 *   - Text-selectable via pdf.js's TextLayer (R3 — selection is read
 *     directly by the classic-script side via `window.getSelection()`
 *     plus walk-up to `.pdf-page[data-page-number]`)
 *   - Cancellable: returns a handle whose .destroy() aborts in-flight
 *     page renders and removes the DOM
 *   - R3 jump-to-passage: handle.scrollToPage(n, rect?) +
 *     handle.highlight(page, rect, durationMs) so the right-panel
 *     insights cards can deep-link back into the PDF
 *
 * Deferred to follow-ups:
 *   - Contents panel (PDF outlines via pdfDoc.getOutline())
 *   - Stable passage-id derivation from (file_hash, page, char_range)
 *     so a selection can address a passage textually (R3 uses
 *     page+rect anchors instead — exact and zero schema cost)
 *   - Page-thumbnail rail, "Convert to markdown" action, search-in-PDF
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
 * Render a PDF into `container`. Returns a handle with .destroy().
 *
 * Accepts either:
 *   - a string URL — pdf.js fetches it directly (no auth, public PDFs only)
 *   - a Uint8Array / ArrayBuffer — the caller has already fetched the
 *     bytes (used by Memu so auth + workspace headers can flow through
 *     the existing api() helper rather than teaching pdf.js about our
 *     X-Memu-* headers)
 *
 * Options (third arg):
 *   - fileName: string — drawn into the chrome header bar
 *   - onPageChange: (pageNumber, total) => void — fires when the
 *     currently-visible page changes (via IntersectionObserver).
 *     The chrome's own page indicator uses this internally; callers
 *     can subscribe too if they need the active page elsewhere.
 *
 * The container is wiped on entry — the viewer takes ownership. Pages
 * render sequentially (not all in parallel) to keep memory bounded on
 * large documents; a typical 40-page paper renders progressively in
 * 2–4s on a modern desktop.
 */
export async function renderPdfInto(source, container, opts = {}) {
  if (!container) throw new Error('renderPdfInto: container is required');

  container.innerHTML = '';
  container.classList.add('pdf-viewer');

  const fileName = (opts && typeof opts.fileName === 'string') ? opts.fileName : '';
  const onPageChange = (opts && typeof opts.onPageChange === 'function') ? opts.onPageChange : null;

  // R3 chrome bar — filename + page nav + (stub) search. Mounted
  // before the page stack so it sits at the top of the viewer
  // column. Page nav buttons wire up after pdfDoc loads (we need
  // numPages first).
  const chrome = document.createElement('div');
  chrome.className = 'pdf-chrome';
  chrome.innerHTML = `
    <div class="pdf-chrome-file mono">
      <span class="pdf-chrome-icon" aria-hidden="true">&#x1F5CE;</span>
      <span class="pdf-chrome-filename">${fileName ? escapeHtml(fileName) : 'Document'}</span>
    </div>
    <div class="pdf-chrome-pages mono">
      <span class="pdf-chrome-page-label">Page <span class="pdf-chrome-current">1</span> / <span class="pdf-chrome-total">…</span></span>
      <button type="button" class="pdf-chrome-btn pdf-chrome-prev" title="Previous page" aria-label="Previous page">&#x25C0;</button>
      <button type="button" class="pdf-chrome-btn pdf-chrome-next" title="Next page" aria-label="Next page">&#x25B6;</button>
    </div>
    <div class="pdf-chrome-tools">
      <button type="button" class="pdf-chrome-btn pdf-chrome-search" title="Find in document (coming soon)" aria-label="Find">
        <span aria-hidden="true">&#x1F50D;</span>
      </button>
    </div>
  `;
  container.appendChild(chrome);

  // Loading affordance while pdf.js fetches + parses the document.
  const loading = document.createElement('div');
  loading.className = 'pdf-loading';
  loading.textContent = 'Loading PDF…';
  container.appendChild(loading);

  let cancelled = false;
  const renderTasks = new Set();
  // Track active highlight timeouts so destroy() can clear them.
  const highlightTimers = new Set();
  // R3 — active page state. Updated by IntersectionObserver on the
  // page elements as the user scrolls. Initialised to 1 (the first
  // page); chrome reads it for the "Page N / total" label.
  let activePage = 1;
  let totalPages = 0;
  let observer = null;

  function findPageEl(pageNumber) {
    if (!container) return null;
    return container.querySelector(`.pdf-page[data-page-number="${pageNumber}"]`);
  }

  function setActivePage(n) {
    if (n === activePage) return;
    activePage = n;
    const cur = chrome.querySelector('.pdf-chrome-current');
    if (cur) cur.textContent = String(n);
    if (onPageChange) {
      try { onPageChange(n, totalPages); } catch { /* fine */ }
    }
  }

  // Chrome nav wiring (uses scrollToPage on the handle once mounted).
  chrome.querySelector('.pdf-chrome-prev').addEventListener('click', () => {
    if (activePage > 1) handle.scrollToPage(activePage - 1);
  });
  chrome.querySelector('.pdf-chrome-next').addEventListener('click', () => {
    if (activePage < totalPages) handle.scrollToPage(activePage + 1);
  });
  // Search stub — call out the deferral honestly rather than fake it.
  chrome.querySelector('.pdf-chrome-search').addEventListener('click', () => {
    console.info('[pdf] find-in-document not yet implemented — use the browser-native Ctrl/Cmd+F as a fallback.');
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch =>
      ch === '&' ? '&amp;' :
      ch === '<' ? '&lt;' :
      ch === '>' ? '&gt;' :
      ch === '"' ? '&quot;' : '&#39;');
  }

  const handle = {
    destroy() {
      cancelled = true;
      for (const t of renderTasks) {
        try { t.cancel(); } catch { /* swallow — already-completed renders throw on cancel */ }
      }
      renderTasks.clear();
      for (const tid of highlightTimers) {
        try { clearTimeout(tid); } catch { /* fine */ }
      }
      highlightTimers.clear();
      if (observer) {
        try { observer.disconnect(); } catch { /* fine */ }
        observer = null;
      }
      try { container.innerHTML = ''; container.classList.remove('pdf-viewer'); } catch { /* fine */ }
    },
    /**
     * Current 1-indexed page number (matches the chrome label).
     */
    getActivePage() { return activePage; },
    /**
     * Total pages in the loaded document. 0 until the first
     * pdfDoc.numPages read finishes.
     */
    getTotalPages() { return totalPages; },
    /**
     * Scroll the container so the given page is in view. If `rect`
     * (page-local CSS-pixel coords) is supplied, scroll so the rect
     * sits roughly 1/3 from the top of the viewport — the "next thing
     * to read" position, not pinned to the very top. Smooth scroll
     * with a fallback to instant for older browsers.
     */
    scrollToPage(pageNumber, rect) {
      const pageEl = findPageEl(pageNumber);
      if (!pageEl) return false;
      // Find the nearest scrolling ancestor (usually .app-main or
      // window). Use scrollIntoView with block:'start', then nudge by
      // the rect's y so the highlight lands a comfortable distance
      // from the top.
      try {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        pageEl.scrollIntoView();
      }
      if (rect && typeof rect.y === 'number' && rect.y > 0) {
        // After scrollIntoView puts the page top at viewport top,
        // nudge down by rect.y - 1/3 viewport. Defer so the
        // smooth-scroll has started before we layer another nudge.
        const nudge = rect.y - Math.max(80, window.innerHeight / 3);
        if (nudge > 0) {
          setTimeout(() => {
            try {
              window.scrollBy({ top: nudge, behavior: 'smooth' });
            } catch {
              window.scrollBy(0, nudge);
            }
          }, 50);
        }
      }
      return true;
    },
    /**
     * Draw a transient highlight rectangle over the given page-local
     * rect. Removed after `durationMs` (default 2200ms). Returns true
     * if the page is mounted, false otherwise.
     */
    highlight(pageNumber, rect, durationMs) {
      const pageEl = findPageEl(pageNumber);
      if (!pageEl || !rect) return false;
      const overlay = document.createElement('div');
      overlay.className = 'pdf-passage-highlight';
      overlay.style.left = `${rect.x}px`;
      overlay.style.top = `${rect.y}px`;
      overlay.style.width = `${Math.max(rect.w, 4)}px`;
      overlay.style.height = `${Math.max(rect.h, 4)}px`;
      pageEl.appendChild(overlay);
      const ms = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 2200;
      const tid = setTimeout(() => {
        try { overlay.remove(); } catch { /* fine */ }
        highlightTimers.delete(tid);
      }, ms);
      highlightTimers.add(tid);
      return true;
    },
  };

  // Discriminate: string → URL-based fetch (pdf.js handles it);
  // ArrayBuffer / Uint8Array → already-fetched bytes (Memu's path).
  // ArrayBuffer must be converted to Uint8Array — pdf.js's `data`
  // option wants typed-array bytes.
  const docInit = (typeof source === 'string')
    ? { url: source }
    : { data: source instanceof Uint8Array ? source : new Uint8Array(source) };

  let pdfDoc;
  try {
    pdfDoc = await getDocument(docInit).promise;
  } catch (err) {
    if (cancelled) return handle;
    loading.textContent = `Couldn't load the PDF: ${err && err.message ? err.message : err}`;
    loading.classList.add('pdf-error');
    return handle;
  }

  if (cancelled) return handle;
  loading.remove();

  totalPages = pdfDoc.numPages;
  const totEl = chrome.querySelector('.pdf-chrome-total');
  if (totEl) totEl.textContent = String(totalPages);

  // IntersectionObserver tracks which page is most-visible in the
  // viewport. Threshold list gives smooth transitions; pick the page
  // with the largest intersection ratio as "active". Fires on scroll;
  // viewer's own scrollToPage also triggers it indirectly via the
  // resulting scroll.
  if ('IntersectionObserver' in window) {
    const ratios = new Map();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const n = parseInt(e.target.dataset.pageNumber, 10);
        if (Number.isFinite(n)) ratios.set(n, e.intersectionRatio);
      }
      // Pick the page with the highest intersection ratio.
      let bestPage = activePage;
      let bestRatio = 0;
      for (const [n, r] of ratios) {
        if (r > bestRatio) { bestRatio = r; bestPage = n; }
      }
      if (bestRatio > 0) setActivePage(bestPage);
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
  }

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
    if (observer) {
      try { observer.observe(pageEl); } catch { /* fine */ }
    }

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

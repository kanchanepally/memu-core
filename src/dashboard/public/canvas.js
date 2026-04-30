// Spaces Canvas v2 — fcose layout, parent_child edges, focus mode,
// three direct-manipulation gestures (plus-handle to create sub-Space,
// drag-to-reparent, drag-edge-to-connect), toast + undo.
//
// Vanilla JS, matches dashboard.html conventions (no React, no bundler).

(function () {
    'use strict';

    // Register fcose layout if globals are present.
    const fcose = window.cytoscapeFcose || window['cytoscape-fcose'] || window.fcose;
    if (window.cytoscape && fcose && typeof window.cytoscape.use === 'function') {
        try { window.cytoscape.use(fcose); } catch (e) { console.warn('fcose registration failed', e); }
    }

    // ---- Indigo Sanctuary palette per category ----
    const CATEGORY_PALETTE = {
        person:     { bg: '#EEF0FB', border: '#5054B5', text: '#2A2D6E' },
        routine:    { bg: '#F0EAF6', border: '#7E5BA8', text: '#3F2A56' },
        household:  { bg: '#EAF1F4', border: '#3F7A8C', text: '#1F3D45' },
        commitment: { bg: '#FAEFE6', border: '#B5723C', text: '#5B391E' },
        document:   { bg: '#EFEFEF', border: '#5C5C5C', text: '#2D2D2D' },
    };
    function paletteFor(category) {
        return CATEGORY_PALETTE[category] || CATEGORY_PALETTE.document;
    }

    // Edge styling per type, per spec §4.5.
    // parent_child gets the parent's category colour; injected in nodeData time.
    const EDGE_STYLE = {
        wikilink:      { color: '#888888', style: 'dashed', width: 1.5, opacity: 0.4 },
        shared_person: { color: '#7E5BA8', style: 'solid',  width: 1.0, opacity: 0.25 },
        shared_tag:    { color: '#888888', style: 'dotted', width: 1.0, opacity: 0.20 },
        shared_domain: { color: '#3F7A8C', style: 'solid',  width: 1.0, opacity: 0.20 },
        // parent_child colour is set per-edge from parent category — see edgeData()
        parent_child:  { color: '#5054B5', style: 'solid',  width: 2.0, opacity: 0.6 },
    };

    const CATEGORY_LABEL = {
        person: 'Person', routine: 'Routine', household: 'Household',
        commitment: 'Commitment', document: 'Document',
    };

    // ---- Sparse-state dismissal — session only. ----
    const SPARSE_DISMISS_KEY = 'memu_canvas_sparse_dismissed';

    // ---- State ----
    const state = {
        cy: null,
        facet: 'category',
        visibility: 'all',
        focusUri: null,
        nodes: [],
        edges: [],
        nodesByUri: new Map(),
        nodesById: new Map(),
        searchTerm: '',
        sparseDismissed: false,
        // Drag state for Gesture 2 (re-parent)
        reparentDrag: null, // {sourceId, originalParent, hoverTargetId, startedAt}
        // Drag state for Gesture 3 (connect)
        connectDrag: null, // {sourceId, hoverTargetId}
        // Last 10 actions for undo (LIFO)
        undoStack: [],
        // Toast handle
        toastTimer: null,
    };
    const UNDO_LIMIT = 10;

    // ---- DOM ----
    const $ = (id) => document.getElementById(id);
    const stage = $('canvas-stage');
    const loading = $('canvas-loading');
    const empty = $('canvas-empty');
    const sparse = $('canvas-sparse');
    const sparseDismiss = $('canvas-sparse-dismiss');
    const cyEl = $('cy');
    const preview = $('canvas-preview');
    const previewCat = $('preview-cat');
    const previewTitle = $('preview-title');
    const previewUpdated = $('preview-updated');
    const previewExcerpt = $('preview-excerpt');
    const previewChildren = $('preview-children');
    const search = $('canvas-search');
    const breadcrumb = $('canvas-breadcrumb');
    const breadcrumbCurrent = $('breadcrumb-current');
    const breadcrumbRoot = $('breadcrumb-root');
    const breadcrumbExit = $('breadcrumb-exit');
    const titleBlock = $('canvas-title');
    const overlays = $('node-overlays');
    const plusBtn = $('node-plus');
    const connectBtn = $('node-connect');
    const focusBtn = $('node-focus');
    const dragSvg = $('canvas-drag-svg');
    const dragLine = $('canvas-drag-line');
    const toast = $('canvas-toast');
    const toastText = $('canvas-toast-text');
    const toastUndo = $('canvas-toast-undo');
    const toastProgress = $('canvas-toast-progress');
    const catPalette = $('canvas-cat-palette');
    const createModal = $('create-modal');
    const createModalParent = $('create-modal-parent');
    const createModalTitle = $('create-modal-title');
    const createModalBody = $('create-modal-body');
    const createModalCancel = $('create-modal-cancel');
    const createModalSave = $('create-modal-save');
    const linkModal = $('link-modal');
    const linkModalSource = $('link-modal-source');
    const linkModalTarget = $('link-modal-target');
    const linkModalLabel = $('link-modal-label');
    const linkModalCancel = $('link-modal-cancel');
    const linkModalSave = $('link-modal-save');

    // ---- Helpers ----
    function show(el) { el && el.classList.remove('hidden'); }
    function hide(el) { el && el.classList.add('hidden'); }

    function formatUpdated(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const diffMs = Date.now() - d.getTime();
        const day = 24 * 60 * 60 * 1000;
        if (diffMs < day) return 'Updated today';
        if (diffMs < 2 * day) return 'Updated yesterday';
        if (diffMs < 7 * day) return `Updated ${Math.floor(diffMs / day)}d ago`;
        return 'Updated ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }

    function nodeData(n) {
        const palette = paletteFor(n.category);
        const isContainer = (n.childCount || 0) > 0;
        return {
            id: n.id,
            label: n.title || 'Untitled',
            category: n.category,
            n: n,
            // Server-computed sizes
            w: n.nodeWidth,
            h: n.nodeHeight,
            bg: palette.bg,
            border: palette.border,
            text: palette.text,
            // Container halo styling — render via duplicate stroke
            isContainer: isContainer ? 1 : 0,
            childBadge: isContainer ? `+${n.childCount}` : '',
            isChild: n.parentSpaceUri ? 1 : 0,
            opacity: 1.0,
        };
    }

    function edgeData(e) {
        const style = EDGE_STYLE[e.type] || EDGE_STYLE.wikilink;
        let color = style.color;
        // parent_child takes the parent's category colour (looks up the
        // parent node, since we have parent → uri on each child).
        if (e.type === 'parent_child') {
            // The graph endpoint emits parent_child as undirected (canonical
            // sort) — find the parent end by looking up parentSpaceUri on
            // each endpoint. The one whose parent equals the other endpoint
            // is the child.
            const sourceNode = state.nodesById.get(e.source);
            const targetNode = state.nodesById.get(e.target);
            const parentNode =
                (targetNode && sourceNode && sourceNode.parentSpaceUri === targetNode.uri) ? targetNode :
                (sourceNode && targetNode && targetNode.parentSpaceUri === sourceNode.uri) ? sourceNode :
                null;
            if (parentNode) color = paletteFor(parentNode.category).border;
        }
        return {
            id: `${e.type}:${e.source}:${e.target}`,
            source: e.source,
            target: e.target,
            type: e.type,
            weight: e.weight,
            color,
            lineStyle: style.style,
            edgeOpacity: style.opacity,
            edgeWidth: style.width,
        };
    }

    // ---- Cytoscape lifecycle ----
    function buildCytoscape(elements) {
        if (state.cy) {
            state.cy.destroy();
            state.cy = null;
        }
        state.cy = window.cytoscape({
            container: cyEl,
            elements,
            wheelSensitivity: 0.3,
            minZoom: 0.25,
            maxZoom: 2.5,
            style: [
                {
                    selector: 'node',
                    style: {
                        'shape': 'round-rectangle',
                        'width': 'data(w)',
                        'height': 'data(h)',
                        'background-color': 'data(bg)',
                        'border-width': 1.5,
                        'border-color': 'data(border)',
                        'color': 'data(text)',
                        'label': 'data(label)',
                        'font-family': 'Inter, system-ui, sans-serif',
                        'font-size': 11,
                        'font-weight': 600,
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'text-wrap': 'wrap',
                        'text-max-width': 'data(w)',
                        'opacity': 'data(opacity)',
                        'transition-property': 'border-width, border-color, opacity, width, height',
                        'transition-duration': '160ms',
                    },
                },
                // Container halo — second stroke painted as overlay
                {
                    selector: 'node[isContainer = 1]',
                    style: {
                        'overlay-color': 'data(border)',
                        'overlay-opacity': 0.15,
                        'overlay-padding': 6,
                    },
                },
                // Sub-Spaces render slightly desaturated
                {
                    selector: 'node[isChild = 1]',
                    style: {
                        'background-blacken': 0.04,
                    },
                },
                {
                    selector: 'node:selected, node.canvas-match',
                    style: { 'border-width': 3, 'border-color': '#5054B5' },
                },
                {
                    selector: 'node.canvas-faded',
                    style: { 'opacity': 0.18 },
                },
                {
                    selector: 'node.canvas-drop-target',
                    style: {
                        'border-width': 3,
                        'border-color': '#5054B5',
                        'overlay-color': '#5054B5',
                        'overlay-opacity': 0.18,
                        'overlay-padding': 8,
                    },
                },
                {
                    selector: 'node.canvas-drop-reject',
                    style: {
                        'border-color': '#B05A5A',
                        'overlay-color': '#B05A5A',
                        'overlay-opacity': 0.18,
                        'overlay-padding': 8,
                    },
                },
                {
                    selector: 'node.canvas-shake',
                    style: {},
                },
                {
                    selector: 'node.canvas-lift',
                    style: {
                        'border-width': 3,
                        'border-color': '#5054B5',
                        'shadow-blur': 12,
                        'shadow-color': '#5054B5',
                        'shadow-opacity': 0.4,
                        'shadow-offset-x': 0,
                        'shadow-offset-y': 4,
                    },
                },
                {
                    selector: 'edge',
                    style: {
                        'curve-style': 'bezier',
                        'line-color': 'data(color)',
                        'line-style': 'data(lineStyle)',
                        'line-opacity': 'data(edgeOpacity)',
                        'width': 'data(edgeWidth)',
                        'target-arrow-shape': 'none',
                        'transition-property': 'line-opacity, width',
                        'transition-duration': '120ms',
                    },
                },
                {
                    selector: 'edge[type = "parent_child"]',
                    style: {
                        'line-style': 'solid',
                        'width': 2.4,
                        'line-opacity': 0.7,
                    },
                },
                {
                    selector: 'edge.canvas-faded',
                    style: { 'line-opacity': 0.06 },
                },
                {
                    selector: 'edge.canvas-highlight',
                    style: { 'line-opacity': 0.95 },
                },
            ],
            layout: layoutOptions(),
        });

        wireInteractions();
    }

    function layoutOptions() {
        const layoutName = (typeof window.cytoscapeFcose !== 'undefined' || (window.cytoscape && window.cytoscape('core', 'fcose')))
            ? 'fcose'
            : 'cose';
        // Spec §3.2 — tile:false + packComponents:true so disconnected
        // nodes get organic positioning instead of a regular grid.
        return {
            name: layoutName,
            randomize: true,
            nodeRepulsion: 8000,
            idealEdgeLength: 100,
            edgeElasticity: 0.45,
            nestingFactor: 0.1,
            gravity: 0.25,
            gravityRange: 3.8,
            numIter: 2500,
            tile: false,
            tilingPaddingVertical: 30,
            tilingPaddingHorizontal: 30,
            packComponents: true,
            fit: true,
            padding: 50,
            animate: true,
            animationDuration: 600,
            animationEasing: 'ease-out',
        };
    }

    function focusLayoutOptions() {
        // Concentric layout for focus mode — parent at centre, children
        // in a single ring around it.
        return {
            name: 'concentric',
            concentric: (n) => n.data('isContainer') === 1 ? 10 : 1,
            levelWidth: () => 1,
            minNodeSpacing: 60,
            spacingFactor: 1.2,
            animate: true,
            animationDuration: 500,
            animationEasing: 'ease-out',
            fit: true,
            padding: 80,
        };
    }

    // ---- Interaction wiring ----
    function wireInteractions() {
        const cy = state.cy;
        if (!cy) return;

        cy.on('mouseover', 'node', (evt) => {
            // Skip overlays mid-drag — distracting and the hover target
            // logic is the source of truth during drag.
            if (state.reparentDrag || state.connectDrag) return;
            const node = evt.target;
            const n = node.data('n');
            if (!n) return;
            showPreview(node, n);
            showNodeOverlays(node, n);
            // Soft-highlight neighbours
            cy.elements().addClass('canvas-faded');
            const neighbourhood = node.closedNeighborhood();
            neighbourhood.removeClass('canvas-faded');
            node.connectedEdges().addClass('canvas-highlight');
        });

        cy.on('mouseout', 'node', () => {
            if (state.reparentDrag || state.connectDrag) return;
            hidePreview();
            // Don't hide overlays if the cursor moved onto an overlay button
            // — the overlay container has pointer-events:none on its frame
            // but the buttons are pointer-events:auto. Use a small timeout
            // and check if the cursor is over an overlay button.
            setTimeout(() => {
                if (!overlays.matches(':hover')) hideNodeOverlays();
            }, 60);
            cy.elements().removeClass('canvas-faded canvas-highlight');
        });

        cy.on('tap', 'node', (evt) => {
            if (state.reparentDrag || state.connectDrag) return;
            const id = evt.target.id();
            navigateToSpace(id);
        });

        cy.on('dbltap', 'node', (evt) => {
            const n = evt.target.data('n');
            if (!n) return;
            if ((n.childCount || 0) > 0) {
                enterFocusMode(n.uri);
            }
        });

        // Tap empty canvas → clear highlights, exit drag if active.
        cy.on('tap', (evt) => {
            if (evt.target === cy) {
                cy.elements().removeClass('canvas-faded canvas-highlight canvas-match canvas-drop-target canvas-drop-reject');
                hidePreview();
                hideNodeOverlays();
            }
        });

        // Gesture 2 (re-parent) — Cytoscape `grab` fires on mousedown of a
        // draggable node, `drag` during movement, `free` on release. A
        // plain click also fires grab+free (no movement between them); we
        // detect that in commitReparentDrag via a movement threshold and
        // bail so the subsequent `tap` event can drive click-to-Space.
        cy.on('grab', 'node', (evt) => {
            const node = evt.target;
            const n = node.data('n');
            if (!n) return;
            startReparentDrag(node, n);
        });
        cy.on('drag', 'node', (evt) => {
            if (!state.reparentDrag) return;
            const node = evt.target;
            updateDropTarget(node);
        });
        cy.on('free', 'node', (evt) => {
            if (!state.reparentDrag) return;
            const node = evt.target;
            commitReparentDrag(node);
        });
    }

    // ---- Hover preview ----
    function showPreview(node, n) {
        previewCat.textContent = CATEGORY_LABEL[n.category] || 'Space';
        previewTitle.textContent = n.title || 'Untitled';
        previewUpdated.textContent = formatUpdated(n.lastUpdated);
        previewExcerpt.textContent = n.excerpt || n.description || 'No description yet.';
        if ((n.childCount || 0) > 0) {
            previewChildren.textContent = `${n.childCount} sub-Space${n.childCount === 1 ? '' : 's'}`;
            show(previewChildren);
        } else {
            hide(previewChildren);
        }
        preview.setAttribute('aria-hidden', 'false');
        show(preview);
        const bbox = node.renderedBoundingBox();
        const stageRect = stage.getBoundingClientRect();
        const left = Math.min(stageRect.width - 296, Math.max(12, bbox.x2 + 12));
        const top = Math.min(stageRect.height - 160, Math.max(12, bbox.y1));
        preview.style.left = left + 'px';
        preview.style.top = top + 'px';
    }
    function hidePreview() {
        preview.setAttribute('aria-hidden', 'true');
        hide(preview);
    }

    // ---- Per-node overlay buttons (Gestures 1 + 3, focus icon) ----
    function showNodeOverlays(node, n) {
        const bbox = node.renderedBoundingBox();
        // Position overlays in stage-space
        // Plus button — top-right
        plusBtn.style.left = `${bbox.x2 - 11}px`;
        plusBtn.style.top = `${bbox.y1 - 11}px`;
        plusBtn.dataset.nodeId = node.id();
        plusBtn.dataset.nodeUri = n.uri;
        // Connect handle — right-middle
        connectBtn.style.left = `${bbox.x2 - 11}px`;
        connectBtn.style.top = `${(bbox.y1 + bbox.y2) / 2 - 11}px`;
        connectBtn.dataset.nodeId = node.id();
        connectBtn.dataset.nodeUri = n.uri;
        // Focus icon — left-middle, only on containers
        if ((n.childCount || 0) > 0 && state.focusUri !== n.uri) {
            focusBtn.style.left = `${bbox.x1 - 11}px`;
            focusBtn.style.top = `${(bbox.y1 + bbox.y2) / 2 - 11}px`;
            focusBtn.dataset.nodeId = node.id();
            focusBtn.dataset.nodeUri = n.uri;
            show(focusBtn);
        } else {
            hide(focusBtn);
        }
        show(overlays);
    }
    function hideNodeOverlays() {
        hide(overlays);
        // Clean style state when overlays vanish
        plusBtn.dataset.nodeId = '';
        connectBtn.dataset.nodeId = '';
        focusBtn.dataset.nodeId = '';
    }

    // Plus-handle click — palette → create modal (Gesture 1)
    plusBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        const parentUri = plusBtn.dataset.nodeUri;
        if (!parentUri) return;
        const parentNode = state.nodesByUri.get(parentUri);
        if (!parentNode) return;
        // Two-level constraint — only top-level Spaces can be parents.
        if (parentNode.parentSpaceUri) {
            showToast('Sub-Spaces cannot have their own children. Create on a top-level Space.');
            return;
        }
        const rect = plusBtn.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        catPalette.style.left = `${rect.left - stageRect.left + 28}px`;
        catPalette.style.top = `${rect.top - stageRect.top}px`;
        catPalette.dataset.parentUri = parentUri;
        catPalette.dataset.parentTitle = parentNode.title;
        show(catPalette);
    });

    // Category-chip click → opens create modal pre-filled with parent.
    catPalette.querySelectorAll('.canvas-cat-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const cat = chip.getAttribute('data-category');
            const parentUri = catPalette.dataset.parentUri;
            const parentTitle = catPalette.dataset.parentTitle || '…';
            hide(catPalette);
            openCreateModal({ parentUri, parentTitle, category: cat });
        });
    });

    // Click outside palette closes it
    document.addEventListener('click', (evt) => {
        if (!catPalette.classList.contains('hidden') &&
            !catPalette.contains(evt.target) &&
            evt.target !== plusBtn &&
            !plusBtn.contains(evt.target)) {
            hide(catPalette);
        }
    });

    // ---- Create modal ----
    function openCreateModal({ parentUri, parentTitle, category }) {
        createModalParent.textContent = parentTitle;
        createModalTitle.value = '';
        createModalBody.value = '';
        createModal.dataset.parentUri = parentUri;
        createModal.dataset.category = category;
        show(createModal);
        setTimeout(() => createModalTitle.focus(), 50);
    }
    createModalCancel.addEventListener('click', () => hide(createModal));
    createModal.addEventListener('click', (evt) => {
        if (evt.target === createModal) hide(createModal);
    });
    createModalSave.addEventListener('click', async () => {
        const title = createModalTitle.value.trim();
        if (!title) { createModalTitle.focus(); return; }
        const body = createModalBody.value;
        const parentUri = createModal.dataset.parentUri;
        const category = createModal.dataset.category;

        createModalSave.disabled = true;
        try {
            const res = await api('/api/spaces', {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    category,
                    body_markdown: body,
                    parent_space_uri: parentUri,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(`Could not create: ${err.error || res.status}`);
                return;
            }
            hide(createModal);
            await loadGraph(); // refresh — keeps parent_child edges + childCount in sync
            showToast(`Added "${title}" under "${createModal.dataset.parentTitle || ''}".`);
        } finally {
            createModalSave.disabled = false;
        }
    });

    // ---- Gesture 2 — drag-to-reparent ----
    // No-drag threshold (in model units, not pixels): if the node moves
    // less than this between grab and free, treat as a click and let
    // the subsequent `tap` event drive click-to-Space.
    const DRAG_THRESHOLD_PX = 5;

    function startReparentDrag(node, n) {
        // Gesture 3 (connect) takes priority — if user grabbed the connect
        // handle, the connect drag is already running and we shouldn't
        // start a reparent.
        if (state.connectDrag) return;
        const pos = node.position();
        state.reparentDrag = {
            sourceId: node.id(),
            sourceUri: n.uri,
            originalParent: n.parentSpaceUri || null,
            hoverTargetId: null,
            startX: pos.x,
            startY: pos.y,
        };
        node.addClass('canvas-lift');
        node.connectedEdges('[type = "parent_child"]').addClass('canvas-faded');
        // Defer the body-level dragging cursor + overlay hide to the FIRST
        // actual drag event — keeps clicks (no movement) clean.
    }
    function updateDropTarget(node) {
        const drag = state.reparentDrag;
        if (!drag) return;
        const pos = node.position();
        const moved = Math.abs(pos.x - drag.startX) + Math.abs(pos.y - drag.startY);
        if (moved < DRAG_THRESHOLD_PX) return; // still in click-territory, no drag chrome yet

        // First time we cross the drag threshold — apply drag chrome.
        if (!drag.dragChromeApplied) {
            drag.dragChromeApplied = true;
            document.body.classList.add('canvas-dragging');
            hideNodeOverlays();
            hidePreview();
        }

        const cy = state.cy;
        const myId = node.id();
        let bestTargetId = null;
        // Find a node we're hovering over (rendered position, point-in-bbox)
        const renderedBbox = node.renderedBoundingBox();
        const cx = (renderedBbox.x1 + renderedBbox.x2) / 2;
        const cy_centre = (renderedBbox.y1 + renderedBbox.y2) / 2;
        cy.nodes().forEach(other => {
            if (other.id() === myId) return;
            const ob = other.renderedBoundingBox();
            if (cx >= ob.x1 && cx <= ob.x2 && cy_centre >= ob.y1 && cy_centre <= ob.y2) {
                bestTargetId = other.id();
            }
        });
        if (bestTargetId !== drag.hoverTargetId) {
            // Clear prior visual
            cy.nodes().removeClass('canvas-drop-target canvas-drop-reject');
            drag.hoverTargetId = bestTargetId;
            if (bestTargetId) {
                const target = cy.getElementById(bestTargetId);
                const targetN = target.data('n');
                // Drop-on-sub-Space → reject visual; drop-on-top-level → accept visual
                if (targetN && targetN.parentSpaceUri) {
                    target.addClass('canvas-drop-reject');
                } else {
                    target.addClass('canvas-drop-target');
                }
            }
        }
    }
    function commitReparentDrag(node) {
        const cy = state.cy;
        const drag = state.reparentDrag;
        if (!drag) return;
        state.reparentDrag = null;

        node.removeClass('canvas-lift');
        cy.nodes().removeClass('canvas-drop-target canvas-drop-reject');
        cy.edges('[type = "parent_child"]').removeClass('canvas-faded');
        document.body.classList.remove('canvas-dragging');

        // No-drag case: user clicked without moving → no drag chrome was
        // applied → there is nothing to commit. Let the subsequent `tap`
        // event drive click-to-Space. (We restore the start position
        // defensively — in practice it's already there.)
        if (!drag.dragChromeApplied) {
            node.position({ x: drag.startX, y: drag.startY });
            return;
        }

        const sourceUri = drag.sourceUri;
        const sourceTitle = (state.nodesByUri.get(sourceUri) || {}).title || 'Space';
        const originalParent = drag.originalParent;
        const targetId = drag.hoverTargetId;

        // Helper — slide the node back to its grab position.
        const snapBack = () => node.animate(
            { position: { x: drag.startX, y: drag.startY } },
            { duration: 220, easing: 'ease-out' },
        );

        if (!targetId) {
            // Dropped in empty space.
            if (originalParent === null) {
                // Already top-level → snap back, nothing to change.
                snapBack();
                return;
            }
            doReparent(sourceUri, sourceTitle, null, originalParent);
            return;
        }

        const target = cy.getElementById(targetId);
        const targetN = target.data('n');
        if (!targetN) { snapBack(); return; }

        if (targetN.parentSpaceUri) {
            // Dropped on a sub-Space → reject with shake + toast, snap back.
            shakeNode(node);
            showToast('Two-level limit. Drop on a top-level Space, or on the canvas to un-nest.');
            setTimeout(snapBack, 240);
            return;
        }

        if (targetN.uri === originalParent) {
            // Dropped on existing parent → no-op snap back.
            snapBack();
            return;
        }

        if (targetN.uri === sourceUri) {
            snapBack();
            return;
        }

        doReparent(sourceUri, sourceTitle, targetN.uri, originalParent, targetN.title);
    }

    async function doReparent(spaceUri, spaceTitle, newParentUri, originalParentUri, newParentTitle) {
        const id = (state.nodesByUri.get(spaceUri) || {}).id;
        if (!id) return;
        try {
            const res = await api(`/api/spaces/${id}/parent`, {
                method: 'POST',
                body: JSON.stringify({ parentSpaceUri: newParentUri }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(`Re-parent failed: ${err.error || res.status}`);
                return;
            }
            const message = newParentUri
                ? `Moved "${spaceTitle}" under "${newParentTitle}".`
                : `"${spaceTitle}" is now a top-level Space.`;
            const undoFn = async () => {
                const r = await api(`/api/spaces/${id}/parent`, {
                    method: 'POST',
                    body: JSON.stringify({ parentSpaceUri: originalParentUri }),
                });
                if (r.ok) loadGraph();
            };
            pushUndo(undoFn);
            showToast(message, { undo: true });
            await loadGraph();
        } catch (err) {
            console.error(err);
            showToast('Re-parent failed.');
        }
    }

    function shakeNode(node) {
        // CSS-driven shake via Cytoscape doesn't have a native shake; we
        // simulate with two quick translation animations.
        const originalPos = { x: node.position('x'), y: node.position('y') };
        const dx = 8;
        node.animate({ position: { x: originalPos.x - dx, y: originalPos.y } }, { duration: 80 });
        setTimeout(() => node.animate({ position: { x: originalPos.x + dx, y: originalPos.y } }, { duration: 80 }), 80);
        setTimeout(() => node.animate({ position: originalPos }, { duration: 80 }), 160);
    }

    // ---- Gesture 3 — drag-edge-to-connect ----
    connectBtn.addEventListener('mousedown', (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        const sourceId = connectBtn.dataset.nodeId;
        const sourceUri = connectBtn.dataset.nodeUri;
        if (!sourceId) return;
        const cy = state.cy;
        if (!cy) return;
        const sourceNode = cy.getElementById(sourceId);
        const bbox = sourceNode.renderedBoundingBox();
        const startX = (bbox.x1 + bbox.x2) / 2;
        const startY = (bbox.y1 + bbox.y2) / 2;
        state.connectDrag = { sourceId, sourceUri, startX, startY, hoverTargetId: null };
        // Configure SVG to stage size
        dragSvg.setAttribute('width', stage.clientWidth);
        dragSvg.setAttribute('height', stage.clientHeight);
        dragLine.setAttribute('x1', startX);
        dragLine.setAttribute('y1', startY);
        dragLine.setAttribute('x2', startX);
        dragLine.setAttribute('y2', startY);
        show(dragSvg);
        document.body.classList.add('canvas-dragging');
        hideNodeOverlays();
        hidePreview();

        document.addEventListener('mousemove', onConnectMove);
        document.addEventListener('mouseup', onConnectUp);
    });

    function onConnectMove(evt) {
        if (!state.connectDrag) return;
        const stageRect = stage.getBoundingClientRect();
        const x = evt.clientX - stageRect.left;
        const y = evt.clientY - stageRect.top;
        dragLine.setAttribute('x2', x);
        dragLine.setAttribute('y2', y);
        // Highlight valid targets — any node under cursor except source
        const cy = state.cy;
        if (!cy) return;
        let bestId = null;
        cy.nodes().forEach(other => {
            if (other.id() === state.connectDrag.sourceId) return;
            const ob = other.renderedBoundingBox();
            if (x >= ob.x1 && x <= ob.x2 && y >= ob.y1 && y <= ob.y2) {
                bestId = other.id();
            }
        });
        if (bestId !== state.connectDrag.hoverTargetId) {
            cy.nodes().removeClass('canvas-drop-target');
            state.connectDrag.hoverTargetId = bestId;
            if (bestId) cy.getElementById(bestId).addClass('canvas-drop-target');
        }
    }

    function onConnectUp() {
        document.removeEventListener('mousemove', onConnectMove);
        document.removeEventListener('mouseup', onConnectUp);
        const drag = state.connectDrag;
        state.connectDrag = null;
        const cy = state.cy;
        if (!cy) return;
        cy.nodes().removeClass('canvas-drop-target');
        hide(dragSvg);
        document.body.classList.remove('canvas-dragging');

        if (!drag || !drag.hoverTargetId) return;
        const sourceId = drag.sourceId;
        const targetId = drag.hoverTargetId;
        if (sourceId === targetId) return;
        const sourceNode = state.nodesById.get(sourceId);
        const targetNode = state.nodesById.get(targetId);
        if (!sourceNode || !targetNode) return;
        openLinkModal({ source: sourceNode, target: targetNode });
    }

    // ---- Link modal ----
    function openLinkModal({ source, target }) {
        linkModalSource.textContent = source.title;
        linkModalTarget.textContent = target.title;
        linkModalLabel.value = 'Related';
        linkModal.dataset.sourceId = source.id;
        linkModal.dataset.sourceUri = source.uri;
        linkModal.dataset.targetUri = target.uri;
        linkModal.dataset.targetSlug = target.slug;
        show(linkModal);
        setTimeout(() => { linkModalLabel.focus(); linkModalLabel.select(); }, 50);
    }
    linkModalCancel.addEventListener('click', () => hide(linkModal));
    linkModal.addEventListener('click', (evt) => { if (evt.target === linkModal) hide(linkModal); });
    linkModalSave.addEventListener('click', async () => {
        const label = linkModalLabel.value.trim() || 'Related';
        const id = linkModal.dataset.sourceId;
        const targetUri = linkModal.dataset.targetUri;
        const targetSlug = linkModal.dataset.targetSlug;
        const sourceUri = linkModal.dataset.sourceUri;
        linkModalSave.disabled = true;
        try {
            const res = await api(`/api/spaces/${id}/links`, {
                method: 'POST',
                body: JSON.stringify({ targetUri, label }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(`Could not connect: ${err.error || res.status}`);
                return;
            }
            hide(linkModal);
            const undoFn = async () => {
                const r = await api(`/api/spaces/${id}/links/${encodeURIComponent(targetSlug)}`, { method: 'DELETE' });
                if (r.ok) loadGraph();
            };
            pushUndo(undoFn);
            showToast(`Connected "${linkModalSource.textContent}" → "${linkModalTarget.textContent}".`, { undo: true });
            await loadGraph();
        } finally {
            linkModalSave.disabled = false;
        }
    });

    // ---- Focus mode ----
    focusBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        const uri = focusBtn.dataset.nodeUri;
        if (uri) enterFocusMode(uri);
    });

    async function enterFocusMode(uri) {
        state.focusUri = uri;
        const node = state.nodesByUri.get(uri);
        if (node) {
            breadcrumbCurrent.textContent = node.title;
        } else {
            breadcrumbCurrent.textContent = 'Container';
        }
        hide(titleBlock);
        show(breadcrumb);
        await loadGraph({ skipAutoLayoutOnFocus: false });
        // Concentric layout once data lands
        if (state.cy) {
            try { state.cy.layout(focusLayoutOptions()).run(); }
            catch (e) { state.cy.layout(layoutOptions()).run(); }
        }
    }

    function exitFocusMode() {
        if (!state.focusUri) return;
        state.focusUri = null;
        hide(breadcrumb);
        show(titleBlock);
        loadGraph();
    }
    breadcrumbRoot.addEventListener('click', (evt) => { evt.preventDefault(); exitFocusMode(); });
    breadcrumbExit.addEventListener('click', exitFocusMode);
    document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape') {
            if (!createModal.classList.contains('hidden')) { hide(createModal); return; }
            if (!linkModal.classList.contains('hidden')) { hide(linkModal); return; }
            if (!catPalette.classList.contains('hidden')) { hide(catPalette); return; }
            if (state.focusUri) exitFocusMode();
        }
    });

    // ---- Toast + Undo stack ----
    function showToast(message, options = {}) {
        if (state.toastTimer) { clearTimeout(state.toastTimer); state.toastTimer = null; }
        toastText.textContent = message;
        if (options.undo) {
            show(toastUndo);
        } else {
            hide(toastUndo);
        }
        // Restart progress animation by removing/re-adding the bar
        toastProgress.style.animation = 'none';
        // Force reflow
        // eslint-disable-next-line no-unused-expressions
        toastProgress.offsetHeight;
        toastProgress.style.animation = '';
        show(toast);
        state.toastTimer = setTimeout(() => hide(toast), 5000);
    }
    toastUndo.addEventListener('click', async () => {
        const fn = popUndo();
        hide(toast);
        if (fn) await fn();
    });

    function pushUndo(fn) {
        state.undoStack.push(fn);
        if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
    }
    function popUndo() { return state.undoStack.pop() || null; }

    // ---- Sparse-state ribbon (≤ 5 edges) ----
    sparseDismiss.addEventListener('click', () => {
        state.sparseDismissed = true;
        hide(sparse);
        try { sessionStorage.setItem(SPARSE_DISMISS_KEY, '1'); } catch (e) { /* ignore */ }
    });

    // ---- Click-to-Space transition ----
    function navigateToSpace(id) {
        window.location.href = `/dashboard.html?space=${encodeURIComponent(id)}#spaces`;
    }

    // ---- Data load ----
    async function loadGraph() {
        show(loading);
        hide(empty);
        hide(sparse);
        try {
            const params = new URLSearchParams({ facet: state.facet, visibility: state.visibility });
            if (state.focusUri) params.set('focus', state.focusUri);
            const res = await api(`/api/spaces/graph?${params.toString()}`);
            if (!res.ok) {
                hide(loading);
                stage.innerHTML += `<div class="canvas-error"><p>Couldn't load the canvas (HTTP ${res.status}).</p><a class="btn btn-secondary btn-sm" href="/dashboard.html#spaces">Back to Spaces</a></div>`;
                return;
            }
            const data = await res.json();
            state.nodes = data.nodes || [];
            state.edges = data.edges || [];
            state.nodesByUri = new Map(state.nodes.map(n => [n.uri, n]));
            state.nodesById = new Map(state.nodes.map(n => [n.id, n]));
            hide(loading);

            if (state.nodes.length === 0) {
                show(empty);
                if (state.cy) { state.cy.destroy(); state.cy = null; }
                return;
            }

            // Sparse-state ribbon decision
            try {
                state.sparseDismissed = state.sparseDismissed || sessionStorage.getItem(SPARSE_DISMISS_KEY) === '1';
            } catch (e) { /* ignore */ }
            if (state.edges.length < 5 && !state.sparseDismissed && !state.focusUri) {
                show(sparse);
            }

            const elements = [
                ...state.nodes.map(n => ({ data: nodeData(n) })),
                ...state.edges.map(e => ({ data: edgeData(e) })),
            ];
            buildCytoscape(elements);
            applySearch();
        } catch (err) {
            console.error('canvas load failed', err);
            hide(loading);
            showToast('Could not reach Memu.');
        }
    }

    // ---- Toolbar wiring ----
    document.querySelectorAll('.canvas-chip[data-facet]').forEach(el => {
        el.addEventListener('click', () => {
            const v = el.getAttribute('data-facet');
            if (v === state.facet) return;
            state.facet = v;
            document.querySelectorAll('.canvas-chip[data-facet]').forEach(x => {
                x.classList.toggle('active', x.getAttribute('data-facet') === v);
            });
            loadGraph();
        });
    });
    document.querySelectorAll('.canvas-chip[data-visibility]').forEach(el => {
        el.addEventListener('click', () => {
            const v = el.getAttribute('data-visibility');
            if (v === state.visibility) return;
            state.visibility = v;
            document.querySelectorAll('.canvas-chip[data-visibility]').forEach(x => {
                x.classList.toggle('active', x.getAttribute('data-visibility') === v);
            });
            loadGraph();
        });
    });

    // ---- Search ----
    function applySearch() {
        const cy = state.cy;
        if (!cy) return;
        const term = state.searchTerm.trim().toLowerCase();
        cy.elements().removeClass('canvas-faded canvas-match');
        if (!term) return;
        const matched = cy.nodes().filter(n => {
            const data = n.data('n') || {};
            return (data.title || '').toLowerCase().includes(term)
                || (data.slug || '').toLowerCase().includes(term)
                || (data.excerpt || '').toLowerCase().includes(term);
        });
        if (matched.length === 0) return;
        cy.elements().addClass('canvas-faded');
        matched.removeClass('canvas-faded').addClass('canvas-match');
        matched.connectedEdges().removeClass('canvas-faded');
    }
    let searchDebounce = null;
    search.addEventListener('input', () => {
        state.searchTerm = search.value;
        if (searchDebounce) clearTimeout(searchDebounce);
        searchDebounce = setTimeout(applySearch, 120);
    });

    // ---- Auto-refresh ----
    // Spec §3.4: refresh on window focus + after canvas-side action.
    // Post-action refresh is handled inside doReparent / Gesture 1 save /
    // Gesture 3 save. Window-focus refresh is wired here.
    let lastFocusRefresh = 0;
    const FOCUS_REFRESH_MIN_MS = 2000; // throttle so re-focus chains don't spam
    window.addEventListener('focus', () => {
        const now = Date.now();
        if (now - lastFocusRefresh < FOCUS_REFRESH_MIN_MS) return;
        lastFocusRefresh = now;
        loadGraph();
    });

    // Kick it off.
    loadGraph();
})();

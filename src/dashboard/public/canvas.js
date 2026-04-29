// Spaces Canvas — Cytoscape view of /api/spaces/graph.
// Vanilla JS, matches dashboard.html conventions (no React, no bundler).

(function () {
    'use strict';

    // Register fcose layout if both globals are present. fcose loads as
    // `cytoscapeFcose` (or `window.cytoscape_fcose` in some bundles).
    const fcose = window.cytoscapeFcose || window['cytoscape-fcose'] || window.fcose;
    if (window.cytoscape && fcose && typeof window.cytoscape.use === 'function') {
        try { window.cytoscape.use(fcose); } catch (e) { console.warn('fcose registration failed; falling back to cose', e); }
    }

    // ---- Indigo Sanctuary palette per category ----
    // Soft pastels for fill, deeper shade for the border. Keeps the
    // canvas readable without screaming for attention.
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

    const EDGE_COLOR = {
        wikilink:      '#5054B5',
        shared_person: '#7E5BA8',
        shared_tag:    '#B5723C',
        shared_domain: '#3F7A8C',
    };

    const CATEGORY_LABEL = {
        person: 'Person',
        routine: 'Routine',
        household: 'Household',
        commitment: 'Commitment',
        document: 'Document',
    };

    // ---- State ----
    const state = {
        cy: null,
        facet: 'category',
        visibility: 'all',
        nodes: [],
        edges: [],
        searchTerm: '',
    };

    // ---- DOM ----
    const $ = (id) => document.getElementById(id);
    const stage = $('canvas-stage');
    const loading = $('canvas-loading');
    const empty = $('canvas-empty');
    const sparse = $('canvas-sparse');
    const cyEl = $('cy');
    const preview = $('canvas-preview');
    const previewCat = $('preview-cat');
    const previewTitle = $('preview-title');
    const previewUpdated = $('preview-updated');
    const previewExcerpt = $('preview-excerpt');
    const search = $('canvas-search');
    const resetBtn = $('canvas-reset');

    // ---- Helpers ----
    function show(el) { el && el.classList.remove('hidden'); }
    function hide(el) { el && el.classList.add('hidden'); }

    function formatUpdated(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const day = 24 * 60 * 60 * 1000;
        if (diffMs < day) return 'Updated today';
        if (diffMs < 2 * day) return 'Updated yesterday';
        if (diffMs < 7 * day) return `Updated ${Math.floor(diffMs / day)}d ago`;
        return 'Updated ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }

    // Node size grows with log(wordcount) and recency. Bigger / brighter
    // means "Memu has more to say about this and recently".
    function nodeSize(node) {
        const wc = node.wordcount || 0;
        const base = 56;
        const wcBoost = Math.min(40, Math.log2(wc + 4) * 6);
        return Math.round(base + wcBoost);
    }

    function recencyOpacity(iso) {
        if (!iso) return 0.7;
        const days = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
        if (days < 7) return 1.0;
        if (days < 30) return 0.95;
        if (days < 90) return 0.85;
        return 0.7;
    }

    function nodeData(n) {
        const palette = paletteFor(n.category);
        const w = nodeSize(n);
        const h = Math.round(w * 0.55);
        return {
            id: n.id,
            label: n.title || 'Untitled',
            category: n.category,
            n: n,
            w, h,
            bg: palette.bg,
            border: palette.border,
            text: palette.text,
            opacity: recencyOpacity(n.lastUpdated),
        };
    }

    function edgeData(e) {
        return {
            id: e.type + ':' + e.source + ':' + e.target,
            source: e.source,
            target: e.target,
            type: e.type,
            weight: e.weight,
            color: EDGE_COLOR[e.type] || '#888',
            // 1.0 weight → 2.4px, 0.3 → 1.0px.
            width: Math.max(0.8, e.weight * 2.4),
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
                        'text-margin-y': 0,
                        'opacity': 'data(opacity)',
                        'transition-property': 'border-width, border-color, opacity',
                        'transition-duration': '120ms',
                    },
                },
                {
                    selector: 'node:selected',
                    style: {
                        'border-width': 3,
                        'border-color': '#5054B5',
                    },
                },
                {
                    selector: 'node.canvas-faded',
                    style: { 'opacity': 0.18 },
                },
                {
                    selector: 'node.canvas-match',
                    style: { 'border-width': 3, 'border-color': '#5054B5' },
                },
                {
                    selector: 'edge',
                    style: {
                        'curve-style': 'bezier',
                        'line-color': 'data(color)',
                        'line-opacity': 0.55,
                        'width': 'data(width)',
                        'target-arrow-shape': 'none',
                        'transition-property': 'line-opacity, width',
                        'transition-duration': '120ms',
                    },
                },
                {
                    selector: 'edge.canvas-faded',
                    style: { 'line-opacity': 0.08 },
                },
                {
                    selector: 'edge.canvas-highlight',
                    style: { 'line-opacity': 0.95, 'width': 'mapData(weight, 0.3, 1.0, 1.4, 3.4)' },
                },
            ],
            layout: layoutOptions(),
        });

        wireInteractions();
    }

    function layoutOptions() {
        // Use fcose if available, else cose-bilkent shape, else cose.
        const layoutName =
            (window.cytoscape && window.cytoscape('core', 'fcose')) ? 'fcose' :
            (typeof window.cytoscapeFcose !== 'undefined') ? 'fcose' : 'cose';
        return {
            name: layoutName,
            animate: true,
            animationDuration: 600,
            randomize: false,
            nodeRepulsion: 6500,
            idealEdgeLength: 110,
            edgeElasticity: 0.35,
            gravity: 0.25,
            tile: true,
            packComponents: true,
            padding: 40,
            nodeSeparation: 80,
            fit: true,
        };
    }

    function wireInteractions() {
        const cy = state.cy;
        if (!cy) return;

        cy.on('mouseover', 'node', (evt) => {
            const n = evt.target.data('n');
            if (!n) return;
            previewCat.textContent = CATEGORY_LABEL[n.category] || 'Space';
            previewTitle.textContent = n.title || 'Untitled';
            previewUpdated.textContent = formatUpdated(n.lastUpdated);
            previewExcerpt.textContent = n.excerpt || n.description || 'No description yet.';
            preview.setAttribute('aria-hidden', 'false');
            show(preview);
            const bbox = evt.target.renderedBoundingBox();
            const stageRect = stage.getBoundingClientRect();
            const left = Math.min(stageRect.width - 280, Math.max(12, bbox.x2 + 12));
            const top = Math.min(stageRect.height - 160, Math.max(12, bbox.y1));
            preview.style.left = left + 'px';
            preview.style.top = top + 'px';

            // Soft-highlight neighbours.
            cy.elements().addClass('canvas-faded');
            const neighbourhood = evt.target.closedNeighborhood();
            neighbourhood.removeClass('canvas-faded');
            evt.target.connectedEdges().addClass('canvas-highlight');
        });

        cy.on('mouseout', 'node', () => {
            preview.setAttribute('aria-hidden', 'true');
            hide(preview);
            cy.elements().removeClass('canvas-faded canvas-highlight');
        });

        cy.on('tap', 'node', (evt) => {
            const id = evt.target.id();
            navigateToSpace(id);
        });

        cy.on('tap', (evt) => {
            // Tap empty canvas → clear selection / reset highlights.
            if (evt.target === cy) {
                cy.elements().removeClass('canvas-faded canvas-highlight canvas-match');
                preview.setAttribute('aria-hidden', 'true');
                hide(preview);
            }
        });
    }

    // Send the user back to the dashboard's Spaces detail view. The
    // dashboard reads `?space=<id>` from the URL on load and routes to
    // openSpaceDetail. Browser back returns here with the canvas state.
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
            const res = await api(`/api/spaces/graph?${params.toString()}`);
            if (!res.ok) {
                stage.innerHTML = `<div class="canvas-error"><p>Couldn’t load the canvas (HTTP ${res.status}).</p><a class="btn btn-secondary btn-sm" href="/dashboard.html#spaces">Back to Spaces</a></div>`;
                return;
            }
            const data = await res.json();
            state.nodes = data.nodes || [];
            state.edges = data.edges || [];
            hide(loading);

            if (state.nodes.length === 0) {
                show(empty);
                if (state.cy) { state.cy.destroy(); state.cy = null; }
                return;
            }
            if (state.nodes.length < 4) show(sparse);

            const elements = [
                ...state.nodes.map(n => ({ data: nodeData(n) })),
                ...state.edges.map(e => ({ data: edgeData(e) })),
            ];
            buildCytoscape(elements);
            applySearch();
        } catch (err) {
            console.error('canvas load failed', err);
            hide(loading);
            stage.innerHTML = `<div class="canvas-error"><p>Couldn’t reach Memu.</p><a class="btn btn-secondary btn-sm" href="/dashboard.html#spaces">Back to Spaces</a></div>`;
        }
    }

    // ---- Toolbar wiring ----
    function setActiveChip(group, value, attr) {
        document.querySelectorAll(`.canvas-chip[data-${attr}]`).forEach(el => {
            el.classList.toggle('active', el.getAttribute(`data-${attr}`) === value);
        });
    }

    document.querySelectorAll('.canvas-chip[data-facet]').forEach(el => {
        el.addEventListener('click', () => {
            const v = el.getAttribute('data-facet');
            if (v === state.facet) return;
            state.facet = v;
            setActiveChip('facet', v, 'facet');
            loadGraph();
        });
    });
    document.querySelectorAll('.canvas-chip[data-visibility]').forEach(el => {
        el.addEventListener('click', () => {
            const v = el.getAttribute('data-visibility');
            if (v === state.visibility) return;
            state.visibility = v;
            setActiveChip('visibility', v, 'visibility');
            loadGraph();
        });
    });

    resetBtn.addEventListener('click', () => {
        if (!state.cy) return;
        state.cy.layout(layoutOptions()).run();
    });

    // Search highlights matching titles + dims the rest. Live.
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

    // Kick it off.
    loadGraph();
})();

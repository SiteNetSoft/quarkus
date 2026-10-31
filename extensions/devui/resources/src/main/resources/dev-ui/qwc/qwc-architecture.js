import { QwcHotReloadElement, html, css, svg, nothing } from 'qwc-hot-reload-element';
import { architecture, architecturePlantUml, architectureMermaid, architecturePath } from 'devui-data';
import '@vaadin/button';
import '@vaadin/icon';
import '@vaadin/tabs';
import '@vaadin/text-field';
import '@vaadin/checkbox';
import '@vaadin/checkbox-group';
import 'qui-ide-link';
import 'qwc-no-data';
import { notifier } from 'notifier';
import { msg, str, updateWhenLocaleChanges } from 'localization';

const NODE_WIDTH = 210;
const NODE_HEIGHT = 58;
const COLUMN_GAP = 110;
const ROW_GAP = 22;
const PADDING = 40;

const LAYERS = ['entry', 'logic', 'data', 'integration', 'external'];

const KIND_COLORS = {
    'rest-endpoint': '#4695eb',
    'route': '#4695eb',
    'websocket': '#3d85c6',
    'grpc-service': '#3d85c6',
    'graphql': '#3d85c6',
    'function': '#3d85c6',
    'scheduled': '#6fa8dc',
    'messaging': '#e69138',
    'bean': '#8e7cc3',
    'repository': '#c27c0e',
    'entity': '#b45f06',
    'rest-client': '#6aa84f',
    'websocket-client': '#6aa84f',
    'database': '#a64d79',
    'cache': '#a64d79',
    'message-broker': '#cc4125',
    'http-service': '#38761d',
    'identity-provider': '#674ea7',
    'service': '#7f7f7f',
    'users': '#4695eb',
    'application': '#4695eb'
};

const EDGE_STYLES = {
    'injects': { dash: '', width: 1.2 },
    'calls': { dash: '', width: 1.8 },
    'queries': { dash: '', width: 1.8 },
    'stored-in': { dash: '2 4', width: 1.2 },
    'publishes': { dash: '7 4', width: 1.8 },
    'delivers': { dash: '7 4', width: 1.8 },
    'uses': { dash: '2 4', width: 1 },
    'manages': { dash: '', width: 1.2 },
    'relates': { dash: '2 4', width: 1 },
    'authenticates': { dash: '4 3', width: 1.5 }
};

/**
 * This component shows the architecture of the application: its components, the external systems it uses,
 * and the relations between them.
 */
export class QwcArchitecture extends QwcHotReloadElement {

    static styles = css`
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }
        .toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 16px;
            flex-wrap: wrap;
        }
        .main {
            display: flex;
            flex: 1;
            min-height: 0;
        }
        .canvas {
            flex: 1;
            position: relative;
            overflow: hidden;
            cursor: grab;
            background-image: radial-gradient(var(--lumo-contrast-10pct) 1px, transparent 1px);
            background-size: 18px 18px;
        }
        .canvas.dragging {
            cursor: grabbing;
        }
        svg {
            width: 100%;
            height: 100%;
            user-select: none;
        }
        .node {
            cursor: pointer;
        }
        .node-body {
            fill: var(--lumo-base-color);
            stroke: var(--lumo-contrast-30pct);
        }
        .node.selected .node-body {
            stroke: var(--quarkus-blue, #4695eb);
            stroke-width: 2.5;
        }
        .node-name {
            fill: var(--lumo-body-text-color);
            font-size: 13px;
            font-weight: 600;
        }
        .node-meta {
            fill: var(--lumo-secondary-text-color);
            font-size: 11px;
        }
        .badge {
            fill: var(--lumo-success-color-10pct, rgba(0, 160, 0, 0.12));
        }
        .badge-text {
            fill: var(--lumo-success-text-color, #2f7d32);
            font-size: 9px;
            font-weight: 600;
        }
        .faded {
            opacity: 0.15;
        }
        .edge {
            fill: none;
            stroke: var(--lumo-contrast-50pct);
        }
        .edge.highlight {
            stroke: var(--quarkus-blue, #4695eb);
        }
        .edge-label {
            fill: var(--lumo-secondary-text-color);
            font-size: 10px;
            paint-order: stroke;
            stroke: var(--lumo-base-color);
            stroke-width: 3px;
        }
        .layer-title {
            fill: var(--lumo-secondary-text-color);
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .boundary {
            fill: none;
            stroke: var(--lumo-contrast-30pct);
            stroke-dasharray: 6 4;
        }
        .boundary-title {
            fill: var(--lumo-secondary-text-color);
            font-size: 12px;
            font-weight: 600;
        }
        .details {
            width: 340px;
            border-left: 1px solid var(--lumo-contrast-10pct);
            padding: 12px 16px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .details h3 {
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .details .kind {
            color: var(--lumo-secondary-text-color);
            font-size: var(--lumo-font-size-s);
        }
        .details ul {
            margin: 0;
            padding-left: 18px;
        }
        .details li {
            font-size: var(--lumo-font-size-s);
            word-break: break-word;
        }
        .details .section {
            font-weight: 600;
            font-size: var(--lumo-font-size-s);
            margin-top: 6px;
        }
        .link {
            cursor: pointer;
            color: var(--quarkus-blue, #4695eb);
        }
        .class-name {
            font-family: var(--lumo-font-family-monospace, monospace);
            font-size: var(--lumo-font-size-xs);
            word-break: break-all;
        }
        .controls {
            position: absolute;
            right: 12px;
            top: 10px;
            display: flex;
            align-items: center;
            gap: 2px;
            background: var(--lumo-base-color);
            border: 1px solid var(--lumo-contrast-10pct);
            border-radius: 6px;
            padding: 0 4px;
        }
        .legend {
            position: absolute;
            left: 12px;
            bottom: 10px;
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            font-size: var(--lumo-font-size-xs);
            color: var(--lumo-secondary-text-color);
            background: var(--lumo-base-color);
            padding: 4px 8px;
            border-radius: 6px;
            border: 1px solid var(--lumo-contrast-10pct);
        }
        .legend span {
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .swatch {
            width: 10px;
            height: 10px;
            border-radius: 2px;
            display: inline-block;
        }
    `;

    static properties = {
        _model: { state: true },
        _lens: { state: true },
        _filter: { state: true },
        _layers: { state: true },
        _selected: { state: true },
        _view: { state: true },
        _dragging: { state: true }
    };

    constructor() {
        super();
        updateWhenLocaleChanges(this);
        this._model = architecture;
        this._lens = 0;
        this._filter = '';
        this._layers = [...LAYERS];
        this._selected = null;
        this._view = { x: 0, y: 0, scale: 1 };
        this._dragging = false;
        this._drag = null;
        this._layout = null;
        this._fitPending = true;
    }

    connectedCallback() {
        super.connectedCallback();
        this.hotReload();
    }

    hotReload() {
        if (!architecturePath) {
            return;
        }
        fetch(architecturePath)
            .then(response => response.ok ? response.json() : null)
            .then(model => {
                if (model) {
                    this._model = model;
                    this._fitPending = true;
                }
            })
            .catch(() => {
                // Keep the build-time model
            });
    }

    updated() {
        if (this._fitPending && this._layout) {
            this._fitPending = false;
            this._fit();
        }
    }

    render() {
        if (!this._model || !this._model.nodes || this._model.nodes.length === 0) {
            return html`<qwc-no-data message="${msg('No components found in this application.', { id: 'architecture-empty' })}"></qwc-no-data>`;
        }
        this._layout = this._lens === 0 ? this._systemLayout() : this._componentLayout();
        return html`
            ${this._renderToolbar()}
            <div class="main">
                <div class="canvas ${this._dragging ? 'dragging' : ''}"
                     @wheel=${this._onWheel}
                     @pointerdown=${this._onPointerDown}
                     @pointermove=${this._onPointerMove}
                     @pointerup=${this._onPointerUp}
                     @pointerleave=${this._onPointerUp}>
                    ${this._renderDiagram()}
                    ${this._renderControls()}
                    ${this._renderLegend()}
                </div>
                ${this._renderDetails()}
            </div>`;
    }

    _renderToolbar() {
        return html`
            <div class="toolbar">
                <vaadin-tabs selected="${this._lens}" @selected-changed=${this._onLensChanged}>
                    <vaadin-tab>${msg('System', { id: 'architecture-lens-system' })}</vaadin-tab>
                    <vaadin-tab>${msg('Components', { id: 'architecture-lens-components' })}</vaadin-tab>
                </vaadin-tabs>
                ${this._lens === 1 ? html`
                    <vaadin-text-field
                        placeholder="${msg('Search', { id: 'architecture-search' })}"
                        clear-button-visible
                        .value=${this._filter}
                        @value-changed=${e => this._filter = e.detail.value || ''}>
                        <vaadin-icon slot="prefix" icon="font-awesome-solid:magnifying-glass"></vaadin-icon>
                    </vaadin-text-field>
                    <vaadin-checkbox-group .value=${this._layers} @value-changed=${this._onLayersChanged} theme="horizontal">
                        <vaadin-checkbox value="entry" label="${msg('Entry points', { id: 'architecture-layer-entry' })}"></vaadin-checkbox>
                        <vaadin-checkbox value="logic" label="${msg('Logic', { id: 'architecture-layer-logic' })}"></vaadin-checkbox>
                        <vaadin-checkbox value="data" label="${msg('Data', { id: 'architecture-layer-data' })}"></vaadin-checkbox>
                        <vaadin-checkbox value="integration" label="${msg('Integration', { id: 'architecture-layer-integration' })}"></vaadin-checkbox>
                        <vaadin-checkbox value="external" label="${msg('External', { id: 'architecture-layer-external' })}"></vaadin-checkbox>
                    </vaadin-checkbox-group>` : nothing}
            </div>`;
    }

    _renderControls() {
        return html`<div class="controls">
                <vaadin-button theme="icon tertiary" title="${msg('Zoom in', { id: 'architecture-zoom-in' })}" @click=${() => this._zoom(1.2)}>
                    <vaadin-icon icon="font-awesome-solid:magnifying-glass-plus"></vaadin-icon>
                </vaadin-button>
                <vaadin-button theme="icon tertiary" title="${msg('Zoom out', { id: 'architecture-zoom-out' })}" @click=${() => this._zoom(1 / 1.2)}>
                    <vaadin-icon icon="font-awesome-solid:magnifying-glass-minus"></vaadin-icon>
                </vaadin-button>
                <vaadin-button theme="icon tertiary" title="${msg('Fit to screen', { id: 'architecture-fit' })}" @click=${this._fit}>
                    <vaadin-icon icon="font-awesome-solid:expand"></vaadin-icon>
                </vaadin-button>
                <vaadin-button theme="tertiary small" title="${msg('Copy as PlantUML', { id: 'architecture-copy-plantuml' })}" @click=${() => this._copy(architecturePlantUml, 'PlantUML')}>
                    <vaadin-icon icon="font-awesome-solid:copy" slot="prefix"></vaadin-icon>PlantUML
                </vaadin-button>
                <vaadin-button theme="tertiary small" title="${msg('Copy as Mermaid', { id: 'architecture-copy-mermaid' })}" @click=${() => this._copy(architectureMermaid, 'Mermaid')}>
                    <vaadin-icon icon="font-awesome-solid:copy" slot="prefix"></vaadin-icon>Mermaid
                </vaadin-button>
                <vaadin-button theme="icon tertiary" title="${msg('Download as SVG', { id: 'architecture-download-svg' })}" @click=${this._downloadSvg}>
                    <vaadin-icon icon="font-awesome-solid:download"></vaadin-icon>
                </vaadin-button>
                <vaadin-button theme="icon tertiary" title="${msg('Open the JSON model', { id: 'architecture-open-json' })}" @click=${() => window.open(architecturePath, '_blank')}>
                    <vaadin-icon icon="font-awesome-solid:code"></vaadin-icon>
                </vaadin-button>
            </div>`;
    }

    _renderDiagram() {
        const layout = this._layout;
        const focus = this._focusSet(layout);
        const { x, y, scale } = this._view;
        return html`
            <svg id="diagram" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--lumo-contrast-50pct)"></path>
                    </marker>
                    <marker id="arrow-highlight" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--quarkus-blue, #4695eb)"></path>
                    </marker>
                </defs>
                <g transform="translate(${x} ${y}) scale(${scale})">
                    ${layout.boundary ? svg`
                        <rect class="boundary" x="${layout.boundary.x}" y="${layout.boundary.y}" width="${layout.boundary.width}" height="${layout.boundary.height}" rx="14"></rect>
                        <text class="boundary-title" x="${layout.boundary.x + 14}" y="${layout.boundary.y + 20}">${layout.boundary.title}</text>` : nothing}
                    ${layout.titles.map(t => svg`<text class="layer-title" x="${t.x}" y="${t.y}" text-anchor="middle">${t.text}</text>`)}
                    ${layout.edges.map(e => this._renderEdge(e, layout, focus))}
                    ${layout.nodes.map(n => this._renderNode(n, focus))}
                </g>
            </svg>`;
    }

    _renderNode(node, focus) {
        const color = KIND_COLORS[node.kind] || '#7f7f7f';
        const faded = focus && !focus.has(node.id);
        const selected = this._selected === node.id;
        const height = node.height || NODE_HEIGHT;
        return svg`
            <g class="node ${faded ? 'faded' : ''} ${selected ? 'selected' : ''}" transform="translate(${node.x} ${node.y})"
               @click=${(e) => this._select(e, node.id)}>
                <title>${node.title || node.name}</title>
                <rect class="node-body" width="${node.width || NODE_WIDTH}" height="${height}" rx="8"></rect>
                <rect width="6" height="${height}" rx="3" fill="${color}"></rect>
                <text class="node-name" x="16" y="23">${this._truncate(node.name, node.width ? 40 : 24)}</text>
                ${node.lines ? node.lines.map((line, i) => svg`<text class="node-meta" x="16" y="${46 + i * 18}">${line}</text>`)
                    : svg`<text class="node-meta" x="16" y="42">${this._truncate(node.meta, node.width ? 52 : 30)}</text>`}
                ${node.devService ? svg`
                    <rect class="badge" x="${(node.width || NODE_WIDTH) - 72}" y="6" width="64" height="15" rx="7"></rect>
                    <text class="badge-text" x="${(node.width || NODE_WIDTH) - 40}" y="16.5" text-anchor="middle">DEV SERVICE</text>` : nothing}
            </g>`;
    }

    _renderEdge(edge, layout, focus) {
        const source = layout.byId.get(edge.source);
        const target = layout.byId.get(edge.target);
        if (!source || !target) {
            return nothing;
        }
        const highlight = this._selected && (edge.source === this._selected || edge.target === this._selected);
        const faded = focus && !(focus.has(edge.source) && focus.has(edge.target));
        const style = EDGE_STYLES[edge.kind] || EDGE_STYLES.uses;
        const path = this._edgePath(source, target, edge.offset || 0);
        const label = edge.label ? `${edge.kind} ${edge.label}` : edge.kind;
        return svg`
            <g class="${faded ? 'faded' : ''}">
                <path class="edge ${highlight ? 'highlight' : ''}" d="${path.d}" stroke-dasharray="${style.dash}"
                      stroke-width="${highlight ? style.width + 1 : style.width}"
                      marker-end="url(#${highlight ? 'arrow-highlight' : 'arrow'})">
                    <title>${label}</title>
                </path>
                ${(highlight || layout.showLabels) && edge.label ? svg`
                    <text class="edge-label" x="${path.mx}" y="${path.my - 4}" text-anchor="middle">${this._truncate(edge.label, 28)}</text>` : nothing}
            </g>`;
    }

    _edgePath(source, target, offset) {
        const sw = source.width || NODE_WIDTH, sh = source.height || NODE_HEIGHT;
        const tw = target.width || NODE_WIDTH, th = target.height || NODE_HEIGHT;
        let sy = source.y + sh / 2, ty = target.y + th / 2;
        // A tall node, like the application, is anchored level with the node at the other end
        if (sh > 2 * NODE_HEIGHT) {
            sy = Math.min(source.y + sh - 20, Math.max(source.y + 20, ty));
        }
        if (th > 2 * NODE_HEIGHT) {
            ty = Math.min(target.y + th - 20, Math.max(target.y + 20, sy));
        }
        sy += offset;
        ty += offset;
        let sx, tx, c1, c2;
        if (Math.abs(source.x - target.x) < 1) {
            // Same column: loop out on the right side
            sx = source.x + sw;
            tx = target.x + tw;
            const bulge = 60 + Math.min(120, Math.abs(ty - sy) / 3);
            c1 = [sx + bulge, sy];
            c2 = [tx + bulge, ty];
        } else if (target.x > source.x) {
            sx = source.x + sw;
            tx = target.x;
            const dx = (tx - sx) / 2;
            c1 = [sx + dx, sy];
            c2 = [tx - dx, ty];
        } else {
            sx = source.x;
            tx = target.x + tw;
            const dx = (sx - tx) / 2;
            c1 = [sx - dx, sy];
            c2 = [tx + dx, ty];
        }
        const d = `M ${sx} ${sy} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${tx} ${ty}`;
        const mx = 0.125 * sx + 0.375 * c1[0] + 0.375 * c2[0] + 0.125 * tx;
        const my = 0.125 * sy + 0.375 * c1[1] + 0.375 * c2[1] + 0.125 * ty;
        return { d, mx, my };
    }

    _renderLegend() {
        const kinds = [...new Set(this._layout.nodes.map(n => n.kind))];
        return html`<div class="legend">
            ${kinds.map(k => html`<span><span class="swatch" style="background:${KIND_COLORS[k] || '#7f7f7f'}"></span>${k}</span>`)}
        </div>`;
    }

    _renderDetails() {
        if (!this._selected) {
            return nothing;
        }
        const node = this._model.nodes.find(n => n.id === this._selected);
        if (!node) {
            return this._renderApplicationDetails();
        }
        const outgoing = this._model.edges.filter(e => e.source === node.id);
        const incoming = this._model.edges.filter(e => e.target === node.id);
        return html`<div class="details">
            <h3>${node.name}
                <vaadin-button theme="icon tertiary small" @click=${() => this._selected = null}>
                    <vaadin-icon icon="font-awesome-solid:xmark"></vaadin-icon>
                </vaadin-button>
            </h3>
            <span class="kind">${node.kind} · ${node.technology}${node.devService ? ' · Dev Service' : ''}</span>
            ${node.className ? html`<qui-ide-link class="class-name" fileName="${node.className}" lineNumber="0">${node.className}</qui-ide-link>` : nothing}
            ${node.details && node.details.length ? html`
                <span class="section">${msg('Details', { id: 'architecture-details' })}</span>
                <ul>${node.details.map(d => html`<li>${d}</li>`)}</ul>` : nothing}
            ${this._renderRelations(msg('Depends on', { id: 'architecture-depends-on' }), outgoing, 'target')}
            ${this._renderRelations(msg('Used by', { id: 'architecture-used-by' }), incoming, 'source')}
        </div>`;
    }

    _renderApplicationDetails() {
        const counts = {};
        for (const node of this._model.nodes) {
            if (node.layer !== 'external') {
                counts[node.kind] = (counts[node.kind] || 0) + 1;
            }
        }
        return html`<div class="details">
            <h3>${this._model.application}
                <vaadin-button theme="icon tertiary small" @click=${() => this._selected = null}>
                    <vaadin-icon icon="font-awesome-solid:xmark"></vaadin-icon>
                </vaadin-button>
            </h3>
            <span class="kind">${this._model.version}</span>
            <span class="section">${msg('Components', { id: 'architecture-lens-components' })}</span>
            <ul>${Object.entries(counts).map(([kind, count]) => html`<li>${count} × ${kind}</li>`)}</ul>
            <span class="link" @click=${() => { this._lens = 1; this._selected = null; this._fitPending = true; }}>
                ${msg('Show the components', { id: 'architecture-show-components' })}
            </span>
        </div>`;
    }

    _renderRelations(title, edges, end) {
        if (edges.length === 0) {
            return nothing;
        }
        return html`
            <span class="section">${title}</span>
            <ul>${edges.map(e => {
                const other = this._model.nodes.find(n => n.id === e[end]);
                const name = other ? other.name : this._model.application;
                return html`<li><span class="link" @click=${(ev) => this._select(ev, e[end])}>${name}</span>
                    <span class="kind">(${e.kind}${e.label ? ' ' + e.label : ''})</span></li>`;
            })}</ul>`;
    }

    // Layouts

    _systemLayout() {
        const model = this._model;
        const externals = model.nodes.filter(n => n.layer === 'external');
        const components = model.nodes.filter(n => n.layer !== 'external');
        const componentIds = new Set(components.map(n => n.id));
        const entryPoints = components.filter(n => n.layer === 'entry' && n.kind !== 'scheduled' && n.kind !== 'messaging');

        // Group the relations between the application and each external system
        const relations = new Map();
        for (const edge of model.edges) {
            const fromApp = componentIds.has(edge.source) || edge.source === 'app';
            const toApp = componentIds.has(edge.target);
            let key = null, direction = null;
            if (fromApp && !toApp) {
                key = edge.target;
                direction = 'out';
            } else if (toApp && !componentIds.has(edge.source) && edge.source !== 'app') {
                key = edge.source;
                direction = 'in';
            }
            if (key) {
                const relation = relations.get(key) || { out: [], in: [], outKind: edge.kind };
                const label = edge.label ? `${edge.kind} ${edge.label}` : edge.kind;
                if (!relation[direction].includes(label)) {
                    relation[direction].push(label);
                }
                relations.set(key, relation);
            }
        }

        const counts = {};
        for (const node of components) {
            counts[node.kind] = (counts[node.kind] || 0) + 1;
        }
        const lines = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([kind, count]) => `${count} × ${kind}`);
        const externalsHeight = externals.length * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
        const appHeight = Math.max(120, 60 + lines.length * 18, externalsHeight);
        const externalsTop = PADDING + (appHeight - Math.max(0, externalsHeight)) / 2;

        const nodes = [];
        const edges = [];
        let x = PADDING;
        const titles = [];
        if (entryPoints.length > 0) {
            nodes.push({
                id: '__users', name: msg('Users and clients', { id: 'architecture-users' }), kind: 'users',
                meta: entryPoints.map(n => n.technology).filter((v, i, a) => a.indexOf(v) === i).join(', '),
                x, y: PADDING + appHeight / 2 - NODE_HEIGHT / 2
            });
            edges.push({ source: '__users', target: 'app', kind: 'calls', label: 'HTTP' });
            x += NODE_WIDTH + COLUMN_GAP;
        }
        nodes.push({
            id: 'app', name: model.application, kind: 'application', lines,
            title: `${model.application} ${model.version}`,
            x, y: PADDING, width: 280, height: appHeight
        });
        x += 280 + COLUMN_GAP + 40;
        externals.forEach((external, i) => {
            nodes.push({
                id: external.id, name: external.name, kind: external.kind, devService: external.devService,
                meta: external.technology, x, y: externalsTop + i * (NODE_HEIGHT + ROW_GAP)
            });
            const relation = relations.get(external.id);
            if (relation) {
                const both = relation.out.length > 0 && relation.in.length > 0;
                if (relation.out.length > 0) {
                    edges.push({ source: 'app', target: external.id, kind: relation.outKind, label: relation.out.join(', '), offset: both ? -9 : 0 });
                }
                if (relation.in.length > 0) {
                    edges.push({ source: external.id, target: 'app', kind: 'delivers', label: relation.in.join(', '), offset: both ? 9 : 0 });
                }
            }
        });
        titles.push({ x: PADDING + 140 + (entryPoints.length > 0 ? NODE_WIDTH + COLUMN_GAP : 0), y: PADDING - 12, text: msg('Application', { id: 'architecture-application' }) });
        if (externals.length > 0) {
            titles.push({ x: x + NODE_WIDTH / 2, y: PADDING - 12, text: msg('External systems', { id: 'architecture-external-systems' }) });
        }
        return this._finishLayout(nodes, edges, titles, null, true);
    }

    _componentLayout() {
        const model = this._model;
        const filter = this._filter.toLowerCase();
        const visible = model.nodes.filter(n => this._layers.includes(n.layer));
        const visibleIds = new Set(visible.map(n => n.id));
        const edges = model.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));

        // Columns by layer, then order each column to reduce crossings
        const columns = LAYERS.filter(l => this._layers.includes(l))
            .map(layer => visible.filter(n => n.layer === layer)
                .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)))
            .filter(column => column.length > 0);
        const neighbours = new Map();
        for (const edge of edges) {
            (neighbours.get(edge.source) || neighbours.set(edge.source, []).get(edge.source)).push(edge.target);
            (neighbours.get(edge.target) || neighbours.set(edge.target, []).get(edge.target)).push(edge.source);
        }
        const position = new Map();
        const updatePositions = () => columns.forEach(column => column.forEach((n, i) => position.set(n.id, i)));
        updatePositions();
        for (let sweep = 0; sweep < 6; sweep++) {
            const order = sweep % 2 === 0 ? columns : [...columns].reverse();
            for (const column of order) {
                const weight = new Map();
                for (const node of column) {
                    const linked = (neighbours.get(node.id) || []).filter(id => position.has(id) && !column.some(c => c.id === id));
                    weight.set(node.id, linked.length > 0
                        ? linked.reduce((sum, id) => sum + position.get(id), 0) / linked.length
                        : position.get(node.id));
                }
                column.sort((a, b) => weight.get(a.id) - weight.get(b.id));
                updatePositions();
            }
        }

        const tallest = Math.max(...columns.map(c => c.length));
        const nodes = [];
        const titles = [];
        columns.forEach((column, ci) => {
            const x = PADDING + ci * (NODE_WIDTH + COLUMN_GAP);
            const offset = (tallest - column.length) * (NODE_HEIGHT + ROW_GAP) / 2;
            titles.push({ x: x + NODE_WIDTH / 2, y: PADDING + 8, text: this._layerTitle(column[0].layer) });
            column.forEach((node, ri) => {
                nodes.push({
                    id: node.id, name: node.name, kind: node.kind, devService: node.devService,
                    meta: node.details && node.details.length ? `${node.technology} · ${node.details[0]}` : node.technology,
                    title: node.className || node.name,
                    matches: !filter || node.name.toLowerCase().includes(filter)
                        || (node.className || '').toLowerCase().includes(filter)
                        || (node.details || []).some(d => d.toLowerCase().includes(filter)),
                    x, y: PADDING + 24 + offset + ri * (NODE_HEIGHT + ROW_GAP)
                });
            });
        });

        // The application boundary surrounds every column except the external systems
        const inside = nodes.filter(n => model.nodes.find(m => m.id === n.id).layer !== 'external');
        let boundary = null;
        if (inside.length > 0) {
            const minX = Math.min(...inside.map(n => n.x)) - 20;
            const maxX = Math.max(...inside.map(n => n.x)) + NODE_WIDTH + 20;
            boundary = {
                x: minX, y: PADDING - 16, width: maxX - minX,
                height: tallest * (NODE_HEIGHT + ROW_GAP) + 56, title: model.application
            };
        }
        return this._finishLayout(nodes, edges, titles, boundary, false);
    }

    _finishLayout(nodes, edges, titles, boundary, showLabels) {
        const byId = new Map(nodes.map(n => [n.id, n]));
        const width = Math.max(...nodes.map(n => n.x + (n.width || NODE_WIDTH))) + PADDING;
        const height = Math.max(...nodes.map(n => n.y + (n.height || NODE_HEIGHT)), boundary ? boundary.y + boundary.height : 0) + PADDING;
        return { nodes, edges, titles, boundary, byId, width, height, showLabels };
    }

    _layerTitle(layer) {
        switch (layer) {
            case 'entry': return msg('Entry points', { id: 'architecture-layer-entry' });
            case 'logic': return msg('Logic', { id: 'architecture-layer-logic' });
            case 'data': return msg('Data', { id: 'architecture-layer-data' });
            case 'integration': return msg('Integration', { id: 'architecture-layer-integration' });
            default: return msg('External', { id: 'architecture-layer-external' });
        }
    }

    _focusSet(layout) {
        const filtered = layout.nodes.filter(n => n.matches === false).length > 0;
        if (!this._selected && !filtered) {
            return null;
        }
        const focus = new Set();
        if (filtered) {
            layout.nodes.filter(n => n.matches !== false).forEach(n => focus.add(n.id));
        }
        if (this._selected && layout.byId.has(this._selected)) {
            focus.add(this._selected);
            for (const edge of layout.edges) {
                if (edge.source === this._selected) {
                    focus.add(edge.target);
                }
                if (edge.target === this._selected) {
                    focus.add(edge.source);
                }
            }
        }
        return focus.size > 0 ? focus : null;
    }

    // Interaction

    _onLensChanged(e) {
        if (this._lens !== e.detail.value) {
            this._lens = e.detail.value;
            this._selected = null;
            this._fitPending = true;
        }
    }

    _onLayersChanged(e) {
        this._layers = e.detail.value;
        this._fitPending = true;
    }

    _select(e, id) {
        e.stopPropagation();
        if (id === '__users') {
            return;
        }
        this._selected = this._selected === id ? null : id;
    }

    _onWheel(e) {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        this._zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    }

    _zoom(factor, cx, cy) {
        const canvas = this.shadowRoot.querySelector('.canvas');
        const px = cx !== undefined ? cx : canvas.clientWidth / 2;
        const py = cy !== undefined ? cy : canvas.clientHeight / 2;
        const scale = Math.min(3, Math.max(0.15, this._view.scale * factor));
        const ratio = scale / this._view.scale;
        this._view = {
            scale,
            x: px - (px - this._view.x) * ratio,
            y: py - (py - this._view.y) * ratio
        };
    }

    _fit() {
        const canvas = this.shadowRoot && this.shadowRoot.querySelector('.canvas');
        if (!canvas || !this._layout || canvas.clientWidth === 0) {
            return;
        }
        const scale = Math.min(1.2, Math.max(0.15, Math.min(canvas.clientWidth / this._layout.width,
            canvas.clientHeight / this._layout.height)));
        this._view = {
            scale,
            x: (canvas.clientWidth - this._layout.width * scale) / 2,
            y: Math.max(0, (canvas.clientHeight - this._layout.height * scale) / 2)
        };
    }

    _onPointerDown(e) {
        if (e.button !== 0 || (e.target.closest && e.target.closest('.node, .controls, .legend'))) {
            return;
        }
        this._drag = { x: e.clientX, y: e.clientY, viewX: this._view.x, viewY: this._view.y, moved: false };
        this._dragging = true;
    }

    _onPointerMove(e) {
        if (!this._drag) {
            return;
        }
        const dx = e.clientX - this._drag.x;
        const dy = e.clientY - this._drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
            this._drag.moved = true;
        }
        this._view = { ...this._view, x: this._drag.viewX + dx, y: this._drag.viewY + dy };
    }

    _onPointerUp() {
        if (this._drag && !this._drag.moved) {
            this._selected = null;
        }
        this._drag = null;
        this._dragging = false;
    }

    // Export

    _copy(text, format) {
        navigator.clipboard.writeText(text).then(
            () => notifier.showInfoMessage(msg(str`${format} diagram copied to the clipboard`, { id: 'architecture-copied' })),
            () => notifier.showErrorMessage(msg('Could not copy to the clipboard', { id: 'architecture-copy-failed' })));
    }

    _downloadSvg() {
        const source = this.shadowRoot.querySelector('#diagram');
        if (!source) {
            return;
        }
        const clone = source.cloneNode(true);
        const group = clone.querySelector('g');
        group.setAttribute('transform', '');
        clone.setAttribute('viewBox', `0 0 ${this._layout.width} ${this._layout.height}`);
        clone.setAttribute('width', this._layout.width);
        clone.setAttribute('height', this._layout.height);
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        const computed = getComputedStyle(this);
        let cssText = QwcArchitecture.styles.cssText;
        for (const variable of ['--lumo-base-color', '--lumo-body-text-color', '--lumo-secondary-text-color',
            '--lumo-contrast-10pct', '--lumo-contrast-30pct', '--lumo-contrast-50pct', '--quarkus-blue',
            '--lumo-success-color-10pct', '--lumo-success-text-color']) {
            const value = computed.getPropertyValue(variable).trim();
            if (value) {
                cssText = cssText.split(`var(${variable})`).join(value);
            }
        }
        style.textContent = cssText;
        clone.insertBefore(style, clone.firstChild);
        const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${this._model.application}-architecture.svg`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    _truncate(text, length) {
        if (!text) {
            return '';
        }
        return text.length > length ? text.substring(0, length - 1) + '…' : text;
    }
}
customElements.define('qwc-architecture', QwcArchitecture);

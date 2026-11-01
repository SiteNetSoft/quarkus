import { QwcHotReloadElement, html, css, svg, nothing } from 'qwc-hot-reload-element';
import { architecture, architecturePlantUml, architectureMermaid, architecturePath } from 'devui-data';
import '@vaadin/button';
import '@vaadin/icon';
import '@vaadin/text-field';
import '@vaadin/checkbox';
import '@vaadin/checkbox-group';
import 'qui-ide-link';
import 'qwc-no-data';
import { notifier } from 'notifier';
import { msg, str, updateWhenLocaleChanges } from 'localization';

const NODE_WIDTH = 230;
const NODE_HEIGHT = 92;
const COLUMN_GAP = 120;
const ROW_GAP = 26;
const PADDING = 40;

const LAYERS = ['entry', 'logic', 'data', 'integration', 'external'];

// The C4 levels, from the outside in
const LEVEL_CONTEXT = 0;
const LEVEL_CONTAINER = 1;
const LEVEL_COMPONENT = 2;
const LEVEL_CODE = 3;
const LEVEL_PATHS = ['context', 'container', 'component', 'component'];
const CONTAINER_KINDS = ['database', 'cache', 'message-broker'];
const CORNER_RADIUS = 8;

let elkInstance = null;

/**
 * Loads the Eclipse Layout Kernel on first use. The bundle is large, so only the component view loads it.
 */
async function loadElk() {
    if (!elkInstance) {
        await import('elkjs/elk.bundled.js');
        elkInstance = new window.ELK();
    }
    return elkInstance;
}
const NETWORK_ENTRY_POINTS = ['rest-endpoint', 'route', 'websocket', 'graphql', 'grpc-service', 'function'];

// The colours of the C4 notation
const C4 = {
    person: { fill: '#08427b', text: '#ffffff', label: 'Person' },
    system: { fill: '#1168bd', text: '#ffffff', label: 'Software system' },
    container: { fill: '#438dd5', text: '#ffffff', label: 'Container' },
    component: { fill: '#85bbf0', text: '#0b2545', label: 'Component' },
    external: { fill: '#8a8a8a', text: '#ffffff', label: 'External system' }
};

const KIND_NAMES = {
    'rest-endpoint': 'REST endpoint',
    'route': 'Route',
    'websocket': 'WebSocket endpoint',
    'grpc-service': 'gRPC service',
    'graphql': 'GraphQL API',
    'function': 'Function',
    'scheduled': 'Scheduled job',
    'messaging': 'Messaging',
    'bean': 'Bean',
    'repository': 'Repository',
    'entity': 'Entity',
    'rest-client': 'REST client',
    'websocket-client': 'WebSocket client',
    'database': 'Database',
    'cache': 'Cache',
    'message-broker': 'Message broker',
    'http-service': 'HTTP service',
    'grpc-service-ext': 'gRPC service',
    'identity-provider': 'Identity provider',
    'service': 'Service'
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
        .node .shape {
            filter: url(#shadow);
            transition: filter 0.15s;
        }
        .node:hover .shape {
            filter: url(#shadow-hover);
        }
        .node.selected .outline {
            stroke: #ff9800;
            stroke-width: 3;
        }
        .node-name {
            font-size: 14px;
            font-weight: 700;
        }
        .node-type {
            font-size: 11px;
            opacity: 0.85;
        }
        .node-text {
            font-size: 11.5px;
            opacity: 0.95;
        }
        .badge {
            fill: #ffffff;
            opacity: 0.92;
        }
        .badge-text {
            fill: #1b7f3b;
            font-size: 8.5px;
            font-weight: 700;
            letter-spacing: 0.04em;
        }
        .band {
            fill: var(--lumo-contrast-5pct);
        }
        .faded {
            opacity: 0.15;
        }
        .edge {
            fill: none;
            stroke: var(--lumo-contrast-50pct);
        }
        .edge.highlight {
            stroke: #ff9800;
        }
        .edge-pill {
            fill: var(--lumo-base-color);
            stroke: var(--lumo-contrast-20pct);
        }
        .edge-label {
            fill: var(--lumo-body-text-color);
            font-size: 10.5px;
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
        .breadcrumb {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: var(--lumo-font-size-m);
            padding: 8px 0;
        }
        .breadcrumb .crumb {
            cursor: pointer;
            color: var(--quarkus-blue, #4695eb);
        }
        .breadcrumb .crumb.current {
            cursor: default;
            color: var(--lumo-body-text-color);
            font-weight: 600;
        }
        .breadcrumb .separator {
            color: var(--lumo-secondary-text-color);
        }
        .hint {
            position: absolute;
            left: 12px;
            top: 10px;
            font-size: var(--lumo-font-size-xs);
            color: var(--lumo-secondary-text-color);
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
        _level: { state: true },
        _focus: { state: true },
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
        this._level = LEVEL_CONTEXT;
        this._focus = null;
        this._filter = '';
        this._layers = [...LAYERS];
        this._selected = null;
        this._view = { x: 0, y: 0, scale: 1 };
        this._dragging = false;
        this._drag = null;
        this._layout = null;
        this._fitPending = true;
        this._elk = null;
        this._elkPending = null;
        this._elkFailed = false;
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
        if (this._fitPending && this._layout && !this._layout.pending) {
            this._fitPending = false;
            this._fit();
        }
    }

    render() {
        if (!this._model || !this._model.nodes || this._model.nodes.length === 0) {
            return html`<qwc-no-data message="${msg('No components found in this application.', { id: 'architecture-empty' })}"></qwc-no-data>`;
        }
        if (this._level === LEVEL_CODE && !this._model.nodes.some(n => n.id === this._focus)) {
            this._level = LEVEL_COMPONENT;
        }
        switch (this._level) {
            case LEVEL_CONTEXT:
            case LEVEL_CONTAINER:
                this._layout = this._applicationLayout(this._level);
                break;
            case LEVEL_COMPONENT:
                this._layout = this._componentLayout();
                break;
            default:
                this._layout = this._codeLayout(this._focus);
        }
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
                    ${this._renderHint()}
                    ${this._renderControls()}
                    ${this._renderLegend()}
                </div>
                ${this._renderDetails()}
            </div>`;
    }

    _renderToolbar() {
        return html`
            <div class="toolbar">
                ${this._renderBreadcrumb()}
                ${this._level === LEVEL_COMPONENT ? html`
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

    _renderBreadcrumb() {
        const crumbs = [
            msg('System context', { id: 'architecture-level-context' }),
            msg('Containers', { id: 'architecture-level-container' }),
            msg('Components', { id: 'architecture-level-component' })
        ];
        if (this._level === LEVEL_CODE) {
            const focus = this._model.nodes.find(n => n.id === this._focus);
            crumbs.push(focus ? focus.name : '');
        }
        return html`<div class="breadcrumb">
            ${crumbs.map((crumb, i) => html`
                ${i > 0 ? html`<span class="separator">›</span>` : nothing}
                <span class="crumb ${i === this._level ? 'current' : ''}" @click=${() => this._goTo(i)}>${crumb}</span>`)}
        </div>`;
    }

    _renderHint() {
        const hints = [
            msg('Double-click the system to see its containers', { id: 'architecture-hint-context' }),
            msg('Double-click the application to see its components', { id: 'architecture-hint-container' }),
            msg('Double-click a component to see its code', { id: 'architecture-hint-component' }),
            msg('Double-click another component to move to it', { id: 'architecture-hint-code' })
        ];
        return html`<span class="hint">${hints[this._level]}</span>`;
    }

    _renderControls() {
        return html`<div class="controls">
                <vaadin-button theme="icon tertiary" title="${msg('Up one level', { id: 'architecture-level-up' })}"
                    ?disabled=${this._level === LEVEL_CONTEXT} @click=${() => this._goTo(this._level - 1)}>
                    <vaadin-icon icon="font-awesome-solid:arrow-turn-up"></vaadin-icon>
                </vaadin-button>
                <vaadin-button theme="icon tertiary" title="${msg('Zoom in', { id: 'architecture-zoom-in' })}" @click=${() => this._zoom(1.2)}>
                    <vaadin-icon icon="font-awesome-solid:magnifying-glass-plus"></vaadin-icon>
                </vaadin-button>
                <vaadin-button theme="icon tertiary" title="${msg('Zoom out', { id: 'architecture-zoom-out' })}" @click=${() => this._zoom(1 / 1.2)}>
                    <vaadin-icon icon="font-awesome-solid:magnifying-glass-minus"></vaadin-icon>
                </vaadin-button>
                <vaadin-button theme="icon tertiary" title="${msg('Fit to screen', { id: 'architecture-fit' })}" @click=${this._fit}>
                    <vaadin-icon icon="font-awesome-solid:expand"></vaadin-icon>
                </vaadin-button>
                <vaadin-button theme="tertiary small" title="${msg('Copy as PlantUML', { id: 'architecture-copy-plantuml' })}" @click=${() => this._copy('plantuml', architecturePlantUml, 'PlantUML')}>
                    <vaadin-icon icon="font-awesome-solid:copy" slot="prefix"></vaadin-icon>PlantUML
                </vaadin-button>
                <vaadin-button theme="tertiary small" title="${msg('Copy as Mermaid', { id: 'architecture-copy-mermaid' })}" @click=${() => this._copy('mermaid', architectureMermaid, 'Mermaid')}>
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
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff9800"></path>
                    </marker>
                    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
                        <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.18"></feDropShadow>
                    </filter>
                    <filter id="shadow-hover" x="-10%" y="-10%" width="120%" height="140%">
                        <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="0.28"></feDropShadow>
                    </filter>
                </defs>
                <g transform="translate(${x} ${y}) scale(${scale})">
                    ${layout.boundary ? svg`
                        <rect class="boundary" x="${layout.boundary.x}" y="${layout.boundary.y}" width="${layout.boundary.width}" height="${layout.boundary.height}" rx="14"></rect>
                        <text class="boundary-title" x="${layout.boundary.x + 14}" y="${layout.boundary.y + 20}">${layout.boundary.title}</text>` : nothing}
                    ${(layout.bands || []).map(b => svg`<rect class="band" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="12"></rect>`)}
                    ${layout.titles.map(t => svg`<text class="layer-title" x="${t.x}" y="${t.y}" text-anchor="middle">${t.text}</text>`)}
                    ${layout.edges.map(e => this._renderEdge(e, layout, focus))}
                    ${layout.nodes.map(n => this._renderNode(n, focus))}
                </g>
            </svg>`;
    }

    _renderNode(node, focus) {
        const faded = focus && !focus.has(node.id);
        const selected = this._selected === node.id;
        const w = node.width || NODE_WIDTH;
        const h = node.height || NODE_HEIGHT;
        const style = node.style || C4.component;
        const top = node.textTop || 0;
        const cx = w / 2;
        const lines = node.lines || [];
        return svg`
            <g class="node ${faded ? 'faded' : ''} ${selected ? 'selected' : ''}" transform="translate(${node.x} ${node.y})"
               @click=${(e) => this._select(e, node.id)}
               @dblclick=${(e) => this._zoomInto(e, node)}>
                <title>${node.title || node.name}</title>
                <g class="shape">${this._shape(node.shape, w, h, style.fill)}</g>
                ${this._shape(node.shape, w, h, 'none', 'outline')}
                <g fill="${style.text}">
                    <text class="node-name" x="${cx}" y="${top + 26}" text-anchor="middle">${this._truncate(node.name, Math.floor(w / 8.5))}</text>
                    <text class="node-type" x="${cx}" y="${top + 44}" text-anchor="middle">${this._truncate(node.type, Math.floor(w / 6.2))}</text>
                    ${lines.map((line, i) => svg`<text class="node-text" x="${cx}" y="${top + 64 + i * 16}" text-anchor="middle">${this._truncate(line, Math.floor(w / 6.4))}</text>`)}
                </g>
                ${node.devService ? svg`
                    <rect class="badge" x="${cx - 35}" y="${h - 22}" width="70" height="14" rx="7"></rect>
                    <text class="badge-text" x="${cx}" y="${h - 12}" text-anchor="middle">DEV SERVICE</text>` : nothing}
            </g>`;
    }

    /**
     * Draws a C4 shape: a box, a person, a database cylinder or a message queue pipe.
     */
    _shape(shape, w, h, fill, cls = '') {
        const stroke = cls ? 'transparent' : 'rgba(0, 0, 0, 0.12)';
        switch (shape) {
            case 'person': {
                const r = 20;
                return svg`<circle class="${cls}" cx="${w / 2}" cy="${r}" r="${r}" fill="${fill}" stroke="${stroke}"></circle>
                    <rect class="${cls}" x="0" y="${2 * r - 6}" width="${w}" height="${h - 2 * r + 6}" rx="22" fill="${fill}" stroke="${stroke}"></rect>`;
            }
            case 'database': {
                const e = 10;
                return svg`<path class="${cls}" d="M 0 ${e} A ${w / 2} ${e} 0 0 1 ${w} ${e} L ${w} ${h - e} A ${w / 2} ${e} 0 0 1 0 ${h - e} Z" fill="${fill}" stroke="${stroke}"></path>
                    <path class="${cls}" d="M 0 ${e} A ${w / 2} ${e} 0 0 0 ${w} ${e}" fill="none" stroke="${cls ? 'transparent' : 'rgba(255, 255, 255, 0.5)'}"></path>`;
            }
            case 'queue': {
                const e = 12;
                return svg`<path class="${cls}" d="M ${e} 0 L ${w - e} 0 A ${e} ${h / 2} 0 0 1 ${w - e} ${h} L ${e} ${h} A ${e} ${h / 2} 0 0 1 ${e} 0 Z" fill="${fill}" stroke="${stroke}"></path>
                    <path class="${cls}" d="M ${w - e} 0 A ${e} ${h / 2} 0 0 0 ${w - e} ${h}" fill="none" stroke="${cls ? 'transparent' : 'rgba(255, 255, 255, 0.5)'}"></path>`;
            }
            default:
                return svg`<rect class="${cls}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}"></rect>`;
        }
    }

    /**
     * Gives a laid out node its C4 shape, colours and text, from the model and the current level.
     */
    _decorate(node) {
        const model = this._model.nodes.find(n => n.id === node.id);
        const level = this._level;
        if (node.id === '__users') {
            Object.assign(node, { shape: 'person', style: C4.person, type: '[Person]', lines: [node.meta], textTop: 34 });
            node.height = node.height || NODE_HEIGHT + 34;
            node.y -= 17;
        } else if (node.id === 'app') {
            node.style = level === LEVEL_CONTEXT ? C4.system : C4.container;
            node.type = level === LEVEL_CONTEXT ? '[Software system]'
                : `[Container: Quarkus${this._model.quarkusVersion ? ' ' + this._model.quarkusVersion : ''}]`;
        } else if (model && model.layer === 'external') {
            const container = CONTAINER_KINDS.includes(model.kind);
            node.shape = model.kind === 'message-broker' ? 'queue' : (model.kind === 'database' || model.kind === 'cache') ? 'database' : 'box';
            node.style = container ? C4.container : C4.external;
            node.type = container ? `[Container: ${model.technology}]` : this._typeOf(KIND_NAMES[model.kind] || 'Software system', model.technology);
            node.lines = node.lines || this._descriptionOf(model, 1);
            if (node.shape === 'database') {
                node.textTop = 6;
            }
        } else if (model) {
            node.style = C4.component;
            node.type = this._typeOf(KIND_NAMES[model.kind] || model.kind, model.technology);
            node.lines = node.lines || this._descriptionOf(model, 2);
        }
        return node;
    }

    _typeOf(kind, technology) {
        return !technology || kind.toLowerCase() === technology.toLowerCase() ? `[${kind}]` : `[${kind}: ${technology}]`;
    }

    _descriptionOf(model, count) {
        const details = (model.details || []).filter(d => !d.startsWith('Dev Service:'));
        return details.slice(0, count);
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
        const path = edge.points ? this._routePath(edge.points) : this._edgePath(source, target, edge.offset || 0);
        const label = edge.label ? `${edge.kind} ${edge.label}` : edge.kind;
        return svg`
            <g class="${faded ? 'faded' : ''}">
                <path class="edge ${highlight ? 'highlight' : ''}" d="${path.d}" stroke-dasharray="${style.dash}"
                      stroke-width="${highlight ? style.width + 1 : style.width}"
                      marker-end="url(#${highlight ? 'arrow-highlight' : 'arrow'})">
                    <title>${label}</title>
                </path>
                ${(highlight || layout.showLabels) && edge.label ? this._renderEdgeLabel(this._truncate(edge.label, 34), path.mx, path.my) : nothing}
            </g>`;
    }

    _renderEdgeLabel(text, x, y) {
        const width = text.length * 5.9 + 14;
        return svg`<rect class="edge-pill" x="${x - width / 2}" y="${y - 9}" width="${width}" height="18" rx="9"></rect>
            <text class="edge-label" x="${x}" y="${y + 3.5}" text-anchor="middle">${text}</text>`;
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

    /**
     * Draws an orthogonal route through its bend points, with rounded corners.
     */
    _routePath(points) {
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length - 1; i++) {
            const [p, c, n] = [points[i - 1], points[i], points[i + 1]];
            const r = Math.min(CORNER_RADIUS, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
            const before = this._towards(c, p, r), after = this._towards(c, n, r);
            d += ` L ${before.x} ${before.y} Q ${c.x} ${c.y}, ${after.x} ${after.y}`;
        }
        const last = points[points.length - 1];
        d += ` L ${last.x} ${last.y}`;

        // The label sits halfway along the route
        const lengths = points.slice(1).map((pt, i) => Math.hypot(pt.x - points[i].x, pt.y - points[i].y));
        let half = lengths.reduce((a, b) => a + b, 0) / 2;
        let mx = points[0].x, my = points[0].y;
        for (let i = 0; i < lengths.length; i++) {
            if (half <= lengths[i] || i === lengths.length - 1) {
                const t = lengths[i] === 0 ? 0 : Math.min(1, half / lengths[i]);
                mx = points[i].x + (points[i + 1].x - points[i].x) * t;
                my = points[i].y + (points[i + 1].y - points[i].y) * t;
                break;
            }
            half -= lengths[i];
        }
        return { d, mx, my };
    }

    _towards(from, to, distance) {
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        return length === 0 ? from : { x: from.x + (to.x - from.x) * distance / length, y: from.y + (to.y - from.y) * distance / length };
    }

    _renderLegend() {
        const styles = [...new Set(this._layout.nodes.map(n => n.style).filter(s => s))];
        return html`<div class="legend">
            ${styles.map(s => html`<span><span class="swatch" style="background:${s.fill}"></span>${s.label}</span>`)}
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
            ${node.layer !== 'external' && this._focus !== node.id ? html`
                <span class="link" @click=${() => this._zoomTo(node.id)}>${msg('Show its code', { id: 'architecture-show-code' })}</span>` : nothing}
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
            ${this._model.quarkusVersion ? html`<span class="kind">Quarkus ${this._model.quarkusVersion}</span>` : nothing}
            <span class="link" @click=${() => this._goTo(this._level + 1)}>
                ${this._level === LEVEL_CONTEXT
                    ? msg('Show the containers', { id: 'architecture-show-containers' })
                    : msg('Show the components', { id: 'architecture-show-components' })}
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

    /**
     * Lays out the context and container levels: the users on the left, the application in the middle, and the
     * external systems on the right. At the container level, the data stores and brokers sit next to the
     * application, inside the boundary of the software system.
     */
    _applicationLayout(level) {
        const model = this._model;
        const isContainer = n => n.layer === 'external' && CONTAINER_KINDS.includes(n.kind);
        const components = model.nodes.filter(n => n.layer !== 'external');
        const containers = level === LEVEL_CONTAINER ? model.nodes.filter(isContainer) : [];
        const externals = model.nodes.filter(n => n.layer === 'external' && !isContainer(n));
        const entryPoints = components.filter(n => NETWORK_ENTRY_POINTS.includes(n.kind));
        const nodesById = new Map(model.nodes.map(n => [n.id, n]));

        // Fold the components, and at the context level the containers, into the application
        const fold = id => {
            const node = nodesById.get(id);
            if (!node) {
                return id === 'app' ? 'app' : null;
            }
            if (node.layer !== 'external' || (level === LEVEL_CONTEXT && isContainer(node))) {
                return 'app';
            }
            return id;
        };
        const folded = new Map();
        for (const edge of model.edges) {
            const source = fold(edge.source), target = fold(edge.target);
            if (source && target && source !== target) {
                const key = `${source}\n${target}`;
                const relation = folded.get(key) || { source, target, kind: edge.kind, labels: [] };
                const label = edge.label ? `${edge.kind} ${edge.label}` : edge.kind;
                if (!relation.labels.includes(label)) {
                    relation.labels.push(label);
                }
                folded.set(key, relation);
            }
        }

        const counts = {};
        for (const node of components) {
            counts[node.kind] = (counts[node.kind] || 0) + 1;
        }
        const lines = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([kind, count]) => `${count} × ${kind}`);
        const columnHeight = count => count * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
        const appWidth = 260;
        const appHeight = Math.max(140, 76 + lines.length * 16, columnHeight(containers.length),
            columnHeight(externals.length));
        const top = PADDING + 30;
        const centered = count => top + (appHeight - Math.max(0, columnHeight(count))) / 2;

        const nodes = [];
        const titles = [];
        let x = PADDING;
        if (entryPoints.length > 0) {
            nodes.push({
                id: '__users', name: msg('Users and clients', { id: 'architecture-users' }), kind: 'users',
                meta: entryPoints.map(n => n.technology).filter((v, i, a) => a.indexOf(v) === i).join(', '),
                x, y: top + appHeight / 2 - NODE_HEIGHT / 2
            });
            x += NODE_WIDTH + COLUMN_GAP;
        }
        const boundaryX = x - 24;
        nodes.push({
            id: 'app', name: model.application, kind: 'application', lines,
            title: `${model.application} ${model.version}`, zoomable: true,
            x, y: top, width: appWidth, height: appHeight
        });
        x += appWidth + COLUMN_GAP;
        containers.forEach((node, i) => nodes.push(this._boxFor(node, x, centered(containers.length) + i * (NODE_HEIGHT + ROW_GAP))));
        let boundary = null;
        if (level === LEVEL_CONTAINER) {
            const right = containers.length > 0 ? x + NODE_WIDTH + 24 : x - COLUMN_GAP + 24;
            boundary = {
                x: boundaryX, y: top - 44, width: right - boundaryX, height: appHeight + 68,
                title: `${model.application} [${msg('Software system', { id: 'architecture-software-system' })}]`
            };
            x = right + COLUMN_GAP - 24;
        }
        externals.forEach((node, i) => nodes.push(this._boxFor(node, x, centered(externals.length) + i * (NODE_HEIGHT + ROW_GAP))));
        if (externals.length > 0) {
            titles.push({ x: x + NODE_WIDTH / 2, y: top - 16, text: msg('External systems', { id: 'architecture-external-systems' }) });
        }

        const edges = [];
        if (entryPoints.length > 0) {
            edges.push({ source: '__users', target: 'app', kind: 'calls', label: 'HTTP' });
        }
        for (const relation of folded.values()) {
            const reverse = folded.has(`${relation.target}\n${relation.source}`);
            edges.push({
                source: relation.source, target: relation.target, kind: relation.kind,
                label: relation.labels.join(', '), offset: reverse ? (relation.source === 'app' ? -9 : 9) : 0
            });
        }
        return this._finishLayout(nodes, edges, titles, boundary, true);
    }

    _boxFor(node, x, y) {
        return {
            id: node.id, name: node.name, kind: node.kind, devService: node.devService,
            meta: node.technology, title: node.details && node.details.length ? node.details.join('\n') : node.name, x, y
        };
    }

    /**
     * Lays out the code level: one component in the middle with its details, the components that use it on the
     * left, and the ones it depends on on the right.
     */
    _codeLayout(id) {
        const model = this._model;
        const focus = model.nodes.find(n => n.id === id);
        const incoming = model.edges.filter(e => e.target === id && e.source !== id);
        const outgoing = model.edges.filter(e => e.source === id && e.target !== id);
        const users = [...new Set(incoming.map(e => e.source))].map(i => model.nodes.find(n => n.id === i)).filter(n => n);
        const dependencies = [...new Set(outgoing.map(e => e.target))].map(i => model.nodes.find(n => n.id === i)).filter(n => n);

        const lines = [focus.className || focus.technology, ...(focus.details || [])];
        const focusWidth = 340;
        const focusHeight = Math.max(NODE_HEIGHT, 76 + lines.length * 16);
        const columnHeight = count => count * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
        const height = Math.max(focusHeight, columnHeight(users.length), columnHeight(dependencies.length));
        const top = PADDING + 30;
        const centered = count => top + (height - Math.max(0, columnHeight(count))) / 2;

        const nodes = [];
        const titles = [];
        let x = PADDING;
        if (users.length > 0) {
            titles.push({ x: x + NODE_WIDTH / 2, y: top - 16, text: msg('Used by', { id: 'architecture-used-by' }) });
            users.forEach((node, i) => nodes.push(this._componentBox(node, x, centered(users.length) + i * (NODE_HEIGHT + ROW_GAP))));
            x += NODE_WIDTH + COLUMN_GAP;
        }
        nodes.push({
            id: focus.id, name: focus.name, kind: focus.kind, devService: focus.devService, lines,
            title: focus.className || focus.name, x, y: top + (height - focusHeight) / 2, width: focusWidth, height: focusHeight
        });
        x += focusWidth + COLUMN_GAP;
        if (dependencies.length > 0) {
            titles.push({ x: x + NODE_WIDTH / 2, y: top - 16, text: msg('Depends on', { id: 'architecture-depends-on' }) });
            dependencies.forEach((node, i) => nodes.push(this._componentBox(node, x, centered(dependencies.length) + i * (NODE_HEIGHT + ROW_GAP))));
        }
        return this._finishLayout(nodes, [...incoming, ...outgoing], titles, null, true);
    }

    _componentBox(node, x, y) {
        return {
            id: node.id, name: node.name, kind: node.kind, devService: node.devService,
            meta: node.details && node.details.length ? `${node.technology} · ${node.details[0]}` : node.technology,
            title: node.className || node.name, x, y
        };
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

        const key = JSON.stringify([columns.map(c => c.map(n => n.id)), edges.map(e => [e.source, e.target])]);
        const elk = this._elk && this._elk.key === key ? this._elk : null;
        if (!elk) {
            this._runElk(key, columns, edges);
        }

        const tallest = Math.max(...columns.map(c => c.length));
        const nodes = [];
        const titles = [];
        const bands = [];
        const top = PADDING + 32;
        columns.forEach((column, ci) => {
            const x = PADDING + ci * (NODE_WIDTH + COLUMN_GAP);
            const offset = (tallest - column.length) * (NODE_HEIGHT + ROW_GAP) / 2;
            titles.push({ x: x + NODE_WIDTH / 2, y: PADDING + 16, text: this._layerTitle(column[0].layer) });
            bands.push({ x: x - 14, y: PADDING, width: NODE_WIDTH + 28, height: tallest * (NODE_HEIGHT + ROW_GAP) + 40 });
            column.forEach((node, ri) => {
                nodes.push({
                    id: node.id, name: node.name, kind: node.kind, devService: node.devService,
                    meta: node.details && node.details.length ? `${node.technology} · ${node.details[0]}` : node.technology,
                    title: node.className || node.name,
                    matches: !filter || node.name.toLowerCase().includes(filter)
                        || (node.className || '').toLowerCase().includes(filter)
                        || (node.details || []).some(d => d.toLowerCase().includes(filter)),
                    x, y: PADDING + 32 + offset + ri * (NODE_HEIGHT + ROW_GAP)
                });
            });
        });

        let routed = edges;
        let contentHeight = tallest * (NODE_HEIGHT + ROW_GAP);
        if (elk) {
            // Move the nodes to the ELK positions, and fit the bands and titles to the columns that ELK made
            for (const node of nodes) {
                const position = elk.nodes.get(node.id);
                node.x = PADDING + position.x;
                node.y = top + position.y;
            }
            titles.length = 0;
            bands.length = 0;
            contentHeight = elk.height + ROW_GAP;
            columns.forEach(column => {
                const placed = nodes.filter(n => column.some(c => c.id === n.id));
                const left = Math.min(...placed.map(n => n.x));
                const right = Math.max(...placed.map(n => n.x + NODE_WIDTH));
                titles.push({ x: (left + right) / 2, y: PADDING + 16, text: this._layerTitle(column[0].layer) });
                bands.push({ x: left - 14, y: PADDING, width: right - left + 28, height: contentHeight + 40 });
            });
            routed = edges.map((edge, i) => {
                const points = elk.routes.get(i);
                return points ? { ...edge, points: points.map(p => ({ x: PADDING + p.x, y: top + p.y })) } : edge;
            });
        }

        // The application boundary surrounds every column except the external systems
        const inside = nodes.filter(n => model.nodes.find(m => m.id === n.id).layer !== 'external');
        let boundary = null;
        if (inside.length > 0) {
            const minX = Math.min(...inside.map(n => n.x)) - 30;
            const maxX = Math.max(...inside.map(n => n.x)) + NODE_WIDTH + 30;
            boundary = {
                x: minX, y: PADDING - 34, width: maxX - minX,
                height: contentHeight + 92,
                title: `${model.application} [Container: Quarkus${model.quarkusVersion ? ' ' + model.quarkusVersion : ''}]`
            };
        }
        const layout = this._finishLayout(nodes, routed, titles, boundary, false, bands);
        layout.pending = !elk && !this._elkFailed;
        return layout;
    }

    /**
     * Lays out the component view with ELK: layered from left to right, one partition for each layer, and
     * orthogonal edges that go around the nodes. The page shows the simple column layout until ELK is done, and
     * keeps it if ELK cannot load.
     */
    _runElk(key, columns, edges) {
        if (this._elkPending === key || this._elkFailed) {
            return;
        }
        this._elkPending = key;
        const ids = new Set(columns.flat().map(n => n.id));
        const graph = {
            id: 'root',
            layoutOptions: {
                'elk.algorithm': 'layered',
                'elk.direction': 'RIGHT',
                'elk.edgeRouting': 'ORTHOGONAL',
                'elk.partitioning.activate': 'true',
                'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
                'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
                'elk.layered.spacing.nodeNodeBetweenLayers': '60',
                'elk.layered.spacing.edgeNodeBetweenLayers': '16',
                'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
                'elk.spacing.nodeNode': String(ROW_GAP),
                'elk.spacing.edgeNode': '20',
                'elk.spacing.edgeEdge': '12',
                'elk.padding': '[top=0,left=0,bottom=0,right=0]'
            },
            children: columns.flat().map(n => ({
                id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT,
                layoutOptions: { 'elk.partitioning.partition': String(LAYERS.indexOf(n.layer)) }
            })),
            edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] }))
                .filter((e, i) => edges[i].source !== edges[i].target && ids.has(edges[i].source) && ids.has(edges[i].target))
        };
        loadElk()
            .then(elk => elk.layout(graph))
            .then(result => {
                if (this._elkPending !== key) {
                    return;
                }
                const routes = new Map();
                for (const edge of result.edges || []) {
                    const section = edge.sections && edge.sections[0];
                    if (section) {
                        routes.set(Number(edge.id.substring(1)), [section.startPoint, ...(section.bendPoints || []), section.endPoint]);
                    }
                }
                this._elk = {
                    key, routes, height: result.height,
                    nodes: new Map(result.children.map(c => [c.id, { x: c.x, y: c.y }]))
                };
                this._elkPending = null;
                this.requestUpdate();
            })
            .catch(error => {
                console.warn('Architecture: ELK layout failed, keeping the column layout', error);
                this._elkFailed = true;
                this._elkPending = null;
                this.requestUpdate();
            });
    }

    _finishLayout(nodes, edges, titles, boundary, showLabels, bands) {
        nodes.forEach(n => this._decorate(n));
        const byId = new Map(nodes.map(n => [n.id, n]));
        const points = edges.flatMap(e => e.points || []);
        const width = Math.max(...nodes.map(n => n.x + (n.width || NODE_WIDTH)), ...points.map(p => p.x)) + PADDING;
        const height = Math.max(...nodes.map(n => n.y + (n.height || NODE_HEIGHT)), ...points.map(p => p.y),
            boundary ? boundary.y + boundary.height : 0) + PADDING;
        return { nodes, edges, titles, boundary, byId, width, height, showLabels, bands };
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

    _goTo(level) {
        if (level < LEVEL_CONTEXT || level > LEVEL_CODE || level === this._level) {
            return;
        }
        if (level === LEVEL_CODE && !this._focus) {
            return;
        }
        this._level = level;
        this._selected = null;
        this._fitPending = true;
    }

    _zoomTo(id) {
        this._focus = id;
        this._level = LEVEL_CODE;
        this._selected = null;
        this._fitPending = true;
    }

    _zoomInto(e, node) {
        e.stopPropagation();
        if (this._level === LEVEL_CONTEXT && node.id === 'app') {
            this._goTo(LEVEL_CONTAINER);
        } else if (this._level === LEVEL_CONTAINER && node.id === 'app') {
            this._goTo(LEVEL_COMPONENT);
        } else if (this._level >= LEVEL_COMPONENT) {
            const model = this._model.nodes.find(n => n.id === node.id);
            if (model && model.layer !== 'external') {
                this._zoomTo(node.id);
            }
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
        const reserved = 56;
        const available = canvas.clientHeight - reserved;
        const scale = Math.min(1.2, Math.max(0.15, Math.min(canvas.clientWidth / this._layout.width,
            available / this._layout.height)));
        this._view = {
            scale,
            x: (canvas.clientWidth - this._layout.width * scale) / 2,
            y: reserved + Math.max(0, (available - this._layout.height * scale) / 2)
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

    _copy(format, buildTimeTexts, title) {
        const level = LEVEL_PATHS[this._level];
        const fallback = buildTimeTexts && typeof buildTimeTexts === 'object' ? buildTimeTexts[level] : buildTimeTexts;
        fetch(`${architecturePath}/${format}/${level}`)
            .then(response => response.ok ? response.text() : fallback)
            .catch(() => fallback)
            .then(text => this._writeClipboard(text, title));
    }

    _writeClipboard(text, format) {
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
            '--lumo-contrast-5pct', '--lumo-contrast-10pct', '--lumo-contrast-20pct', '--lumo-contrast-30pct',
            '--lumo-contrast-50pct', '--quarkus-blue',
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

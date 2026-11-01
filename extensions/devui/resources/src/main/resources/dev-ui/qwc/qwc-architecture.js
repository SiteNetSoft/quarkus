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
import { JsonRpc } from 'jsonrpc';
import { jsonRPCMethods } from 'devui-jsonrpc-data';
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
const OTEL_NAMESPACE = 'quarkus-opentelemetry';
const HOP_MILLIS = 900;
const STEP_PAUSE_MILLIS = 450;
// A replay route prefers the call edges to the edges that only show a type or a relation
const ROUTE_COSTS = { 'uses': 4, 'relates': 4 };
const TRAFFIC_RELOAD_MILLIS = 1000;
// The enum values of OTLP, in the order of their numbers
const OTLP_SPAN_KINDS = ['INTERNAL', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];
const OTLP_STATUS_CODES = ['UNSET', 'OK', 'ERROR'];
const NO_PARENT_SPAN = '0000000000000000';

/**
 * Reads the spans of an OTLP JSON file. The file holds one export request, or one request per line as the file
 * exporter of the OpenTelemetry Collector writes them. The spans get the format of the Dev UI traces store.
 */
function spansOfOtlp(text) {
    const trimmed = text.trim();
    let requests;
    try {
        requests = [JSON.parse(trimmed)];
    } catch (e) {
        requests = trimmed.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    }
    const spans = [];
    for (const request of requests.flat()) {
        // Older exports and the Tempo API use other names for the same levels
        for (const resourceSpans of request.resourceSpans || request.batches || []) {
            const resource = otlpAttributes(resourceSpans.resource && resourceSpans.resource.attributes);
            for (const scopeSpans of resourceSpans.scopeSpans || resourceSpans.instrumentationLibrarySpans || []) {
                const scope = scopeSpans.scope || scopeSpans.instrumentationLibrary || {};
                for (const span of scopeSpans.spans || []) {
                    spans.push(spanOfOtlp(span, resource, scope));
                }
            }
        }
    }
    return spans;
}

function spanOfOtlp(span, resource, scope) {
    const start = BigInt(span.startTimeUnixNano || 0);
    const end = BigInt(span.endTimeUnixNano || 0);
    const status = span.status || {};
    return {
        traceId: otlpId(span.traceId),
        spanId: otlpId(span.spanId),
        parentSpanId: span.parentSpanId ? otlpId(span.parentSpanId) : NO_PARENT_SPAN,
        name: span.name || '',
        kind: otlpEnum(span.kind, OTLP_SPAN_KINDS, 'SPAN_KIND_'),
        startEpochNanos: Number(start),
        endEpochNanos: Number(end),
        durationNanos: Number(end - start),
        statusCode: otlpEnum(status.code, OTLP_STATUS_CODES, 'STATUS_CODE_'),
        statusDescription: status.message || '',
        scopeName: scope.name || '',
        resourceServiceName: resource['service.name'] || '',
        resourceServiceVersion: resource['service.version'] || '',
        attributes: otlpAttributes(span.attributes),
        events: (span.events || []).map(event => `${event.name} @${event.timeUnixNano}`)
    };
}

function otlpAttributes(attributes) {
    const result = {};
    for (const attribute of attributes || []) {
        result[attribute.key] = otlpValue(attribute.value);
    }
    return result;
}

function otlpValue(value) {
    if (!value) {
        return '';
    }
    if ('stringValue' in value) {
        return value.stringValue;
    }
    if ('intValue' in value) {
        return String(value.intValue);
    }
    if ('doubleValue' in value) {
        return String(value.doubleValue);
    }
    if ('boolValue' in value) {
        return String(value.boolValue);
    }
    if ('arrayValue' in value) {
        return `[${(value.arrayValue.values || []).map(otlpValue).join(', ')}]`;
    }
    if ('kvlistValue' in value) {
        return JSON.stringify(otlpAttributes(value.kvlistValue.values));
    }
    return value.bytesValue || '';
}

function otlpEnum(value, names, prefix) {
    if (typeof value === 'number') {
        return names[value] || names[0];
    }
    if (typeof value === 'string' && value.startsWith(prefix)) {
        return value.substring(prefix.length).replace('UNSPECIFIED', names[0]);
    }
    return value || names[0];
}

/**
 * @return the id in lower-case hex. OTLP JSON uses hex, but the generic protobuf JSON mapping uses base64.
 */
function otlpId(id) {
    if (!id || /^[0-9a-fA-F]+$/.test(id) && (id.length === 16 || id.length === 32)) {
        return (id || '').toLowerCase();
    }
    return [...atob(id)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

/**
 * Groups the spans by trace, in the format of the Dev UI traces store, with the newest trace first.
 */
function tracesOfSpans(spans) {
    const traces = new Map();
    for (const span of spans) {
        let trace = traces.get(span.traceId);
        if (!trace) {
            trace = { traceId: span.traceId, windowStart: span.startEpochNanos, windowEnd: span.endEpochNanos, spans: [] };
            traces.set(span.traceId, trace);
        }
        trace.windowStart = Math.min(trace.windowStart, span.startEpochNanos);
        trace.windowEnd = Math.max(trace.windowEnd, span.endEpochNanos);
        trace.spans.push(span);
    }
    return [...traces.values()].sort((a, b) => b.windowStart - a.windowStart);
}

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
        .node.replay-current .outline {
            stroke: #ff9800;
            stroke-width: 3;
        }
        .replay-route {
            fill: none;
            stroke: #ff9800;
            stroke-width: 3;
            stroke-linecap: round;
        }
        .replay-dot {
            fill: #ff9800;
            stroke: var(--lumo-base-color);
            stroke-width: 2;
        }
        .replay-pill {
            fill: #ff9800;
        }
        .replay-pill.error {
            fill: var(--lumo-error-color, #e53935);
        }
        .replay-pill-text {
            fill: #ffffff;
            font-size: 10.5px;
            font-weight: 700;
        }
        .edge.traffic {
            stroke: #ff9800;
            stroke-opacity: 0.75;
        }
        .traffic-pill-text {
            fill: #ffffff;
            font-size: 10.5px;
            font-weight: 700;
        }
        .replay table {
            border-collapse: collapse;
            font-size: var(--lumo-font-size-s);
            font-variant-numeric: tabular-nums;
        }
        .replay th, .replay td {
            text-align: right;
            padding: 2px 4px;
            white-space: nowrap;
        }
        .replay th:first-child, .replay td:first-child {
            text-align: left;
        }
        .replay th {
            font-weight: 600;
            color: var(--lumo-secondary-text-color);
        }
        .replay td.error {
            color: var(--lumo-error-text-color, #e53935);
        }
        .replay-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 2px;
        }
        .details .kind.warning {
            color: var(--lumo-warning-text-color, #b26a00);
        }
        .details.replay {
            overflow-x: hidden;
        }
        .replay ol, .replay ul {
            list-style: none;
            padding-left: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .replay li {
            padding: 4px 6px;
            border-radius: 4px;
            cursor: pointer;
        }
        .replay li:hover {
            background: var(--lumo-contrast-5pct);
        }
        .replay li.current {
            background: rgba(255, 152, 0, 0.18);
        }
        .replay li.pending {
            opacity: 0.5;
        }
        .replay li.error .duration {
            color: var(--lumo-error-text-color, #e53935);
        }
        .replay .duration {
            float: right;
            font-variant-numeric: tabular-nums;
            color: var(--lumo-secondary-text-color);
        }
        .replay .span-name {
            display: block;
            font-size: var(--lumo-font-size-xs);
            color: var(--lumo-secondary-text-color);
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
        _dragging: { state: true },
        _replay: { state: true }
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
        this._replay = null;
        this._replayTimer = null;
        this._replayFrame = null;
        this._animatedStep = null;
        this._otel = null;
        this._traffic = null;
        this._spanStream = null;
        this._trafficReload = null;
    }

    disconnectedCallback() {
        this._showTraffic(false);
        this._stopReplay();
        super.disconnectedCallback();
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
        this._animateStep();
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
                ${this._replay ? this._renderReplay() : this._renderDetails()}
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
                <vaadin-button theme="icon tertiary" title="${msg('Replay a trace', { id: 'architecture-replay' })}" @click=${this._openReplay}>
                    <vaadin-icon icon="font-awesome-solid:circle-play"></vaadin-icon>
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
                    <marker id="arrow-traffic" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
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
                    ${this._renderReplayRoute(layout)}
                    ${layout.nodes.map(n => this._renderNode(n, focus))}
                    ${this._renderReplayMarks(layout)}
                    ${this._renderTrafficMarks(layout)}
                </g>
            </svg>`;
    }

    _renderNode(node, focus) {
        const faded = focus && !focus.has(node.id);
        const step = this._currentStep();
        const selected = this._selected === node.id || (step !== null && step.node === node.id);
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
        const traffic = this._traffic ? this._traffic.edges.get(`${edge.source}\n${edge.target}`) : null;
        const faded = this._traffic ? !traffic : focus && !(focus.has(edge.source) && focus.has(edge.target));
        const style = EDGE_STYLES[edge.kind] || EDGE_STYLES.uses;
        const path = edge.points ? this._routePath(edge.points) : this._edgePath(source, target, edge.offset || 0);
        const label = edge.label ? `${edge.kind} ${edge.label}` : edge.kind;
        const width = traffic
            ? 1.5 + 5 * Math.log(traffic + 1) / Math.log(this._traffic.maxEdge + 1)
            : (highlight ? style.width + 1 : style.width);
        return svg`
            <g class="${faded ? 'faded' : ''}">
                <path class="edge ${highlight ? 'highlight' : ''} ${traffic ? 'traffic' : ''}" d="${path.d}"
                      stroke-dasharray="${traffic ? '' : style.dash}" stroke-width="${width}"
                      marker-end="url(#${traffic ? 'arrow-traffic' : highlight ? 'arrow-highlight' : 'arrow'})">
                    <title>${traffic ? `${label}: ${traffic} calls` : label}</title>
                </path>
                ${traffic ? this._renderEdgeLabel(`${traffic}×`, path.mx, path.my)
                    : (highlight || layout.showLabels) && edge.label ? this._renderEdgeLabel(this._truncate(edge.label, 34), path.mx, path.my) : nothing}
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
                'elk.separateConnectedComponents': 'false',
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
        if (this._traffic) {
            return new Set([...this._traffic.edgeNodes, ...this._traffic.nodes.keys()]);
        }
        const step = this._currentStep();
        if (step) {
            const focus = new Set(step.path);
            for (const done of this._replay.steps.slice(0, this._replay.index + 1)) {
                done.path.forEach(id => focus.add(id));
            }
            return focus;
        }
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

    // Trace replay

    /**
     * Opens the trace replay panel on the component view. The spans come from the Dev UI traces store of the
     * OpenTelemetry extension, when the application uses it.
     */
    _openReplay() {
        this._goTo(LEVEL_COMPONENT);
        this._selected = null;
        const available = jsonRPCMethods.includes(`${OTEL_NAMESPACE}_getSnapshot`);
        this._replay = { available, traces: null, file: null, filter: '', trace: null, steps: [], index: -1, playing: false };
        if (available) {
            this._loadTraces();
        }
    }

    _closeReplay() {
        this._showTraffic(false);
        this._stopReplay();
        this._replay = null;
    }

    _loadTraces() {
        if (!this._otel) {
            this._otel = new JsonRpc(OTEL_NAMESPACE);
        }
        this._otel.getSnapshot().then(response => {
            if (this._replay && !this._replay.file) {
                this._replay = { ...this._replay, traces: response.result.traces ?? [] };
                if (this._traffic) {
                    this._traffic = this._trafficOf(this._visibleTraces());
                }
            }
        });
    }

    /**
     * Goes back from the traces of a file to the traces of the running application.
     */
    _showLiveTraces() {
        const traffic = !!this._traffic;
        this._showTraffic(false);
        this._replay = { ...this._replay, traces: null, file: null };
        this._loadTraces();
        this._showTraffic(traffic);
    }

    /**
     * Loads the traces of an OTLP JSON file, for example an export from production. The browser reads the file, and
     * the data does not leave it. When the file holds many services, only the spans of this application stay.
     */
    async _importFile(file) {
        if (!file) {
            return;
        }
        let spans;
        try {
            spans = spansOfOtlp(await file.text());
        } catch (e) {
            notifier.showErrorMessage(msg(str`${file.name} is not an OTLP JSON file: ${e.message}`, { id: 'architecture-import-invalid' }));
            return;
        }
        const application = this._model.application;
        const own = spans.filter(s => s.resourceServiceName === application);
        const kept = own.length > 0 ? own : spans;
        const warnings = [];
        if (own.length === 0 && spans.length > 0) {
            const services = [...new Set(spans.map(s => s.resourceServiceName || '?'))].join(', ');
            warnings.push(msg(str`No span comes from the service ${application}. The page shows the spans of: ${services}.`, { id: 'architecture-import-other-service' }));
        } else if (own.length < spans.length) {
            warnings.push(msg(str`${spans.length - own.length} spans of other services are left out.`, { id: 'architecture-import-left-out' }));
        }
        const versions = [...new Set(kept.map(s => s.resourceServiceVersion).filter(v => v && v !== this._model.version))];
        if (versions.length > 0) {
            warnings.push(msg(str`The spans come from version ${versions.join(', ')}, and the application has version ${this._model.version}. Some spans can match no component.`, { id: 'architecture-import-version' }));
        }
        const traffic = !!this._traffic;
        this._showTraffic(false);
        this._stopReplay();
        this._replay = { ...this._replay, traces: tracesOfSpans(kept), file: { name: file.name, warnings }, trace: null, steps: [], index: -1, playing: false };
        this._showTraffic(traffic);
    }

    _filterTraces(filter) {
        this._replay = { ...this._replay, filter };
        if (this._traffic) {
            this._traffic = this._trafficOf(this._visibleTraces());
        }
    }

    _selectTrace(trace) {
        this._showTraffic(false);
        this._stopReplay();
        this._replay = { ...this._replay, trace, steps: this._stepsOf(trace), index: -1, playing: false };
        this._play();
    }

    _play() {
        const replay = this._replay;
        if (!replay || replay.steps.length === 0) {
            return;
        }
        const index = replay.index >= replay.steps.length - 1 ? -1 : replay.index;
        this._replay = { ...replay, index, playing: true };
        this._advance();
    }

    _pause() {
        this._stopReplay();
        if (this._replay) {
            this._replay = { ...this._replay, playing: false };
        }
    }

    _stepTo(index) {
        this._stopReplay();
        const last = this._replay.steps.length - 1;
        this._replay = { ...this._replay, index: Math.max(-1, Math.min(last, index)), playing: false };
    }

    _advance() {
        const replay = this._replay;
        if (!replay || !replay.playing) {
            return;
        }
        const index = replay.index + 1;
        if (index >= replay.steps.length) {
            this._replay = { ...replay, playing: false };
            return;
        }
        this._replay = { ...replay, index };
        const hops = Math.max(1, replay.steps[index].path.length - 1);
        this._replayTimer = setTimeout(() => this._advance(), hops * HOP_MILLIS + STEP_PAUSE_MILLIS);
    }

    _stopReplay() {
        clearTimeout(this._replayTimer);
        cancelAnimationFrame(this._replayFrame);
        this._replayTimer = null;
        this._replayFrame = null;
    }

    _currentStep() {
        const replay = this._replay;
        return replay && replay.index >= 0 && replay.index < replay.steps.length ? replay.steps[replay.index] : null;
    }

    /**
     * Turns the spans of a trace into replay steps. A step is a span that belongs to a node of the model. It goes
     * from the node of the closest ancestor span to its own node, along the shortest path in the model, so the
     * beans without spans light up on the way.
     */
    _stepsOf(trace) {
        const spans = [...trace.spans].sort((a, b) => a.startEpochNanos - b.startEpochNanos);
        const byId = new Map(spans.map(s => [s.spanId, s]));
        const mapped = new Map(spans.map(s => [s.spanId, this._nodeForSpan(s)]));
        const start = spans.length > 0 ? spans[0].startEpochNanos : 0;
        const steps = [];
        for (const span of spans) {
            const target = mapped.get(span.spanId);
            if (!target) {
                continue;
            }
            let from = target.via || null;
            for (let parent = byId.get(span.parentSpanId); !from && parent; parent = byId.get(parent.parentSpanId)) {
                from = mapped.get(parent.spanId) ? mapped.get(parent.spanId).node : null;
            }
            if (from === target.node) {
                continue;
            }
            steps.push({
                span, from, node: target.node,
                path: from ? this._path(from, target.node) : [target.node],
                offset: (span.startEpochNanos - start) / 1e6,
                duration: span.durationNanos / 1e6,
                error: span.statusCode === 'ERROR'
            });
        }
        return steps;
    }

    /**
     * Finds the node of the model that a span belongs to, from the OpenTelemetry semantic conventions.
     *
     * @return the node id, and for a received message the broker it comes from, or null
     */
    _nodeForSpan(span) {
        const attributes = span.attributes || {};
        const nodes = this._model.nodes;
        const edges = this._model.edges;
        const isBroker = id => nodes.some(n => n.id === id && n.kind === 'message-broker');

        // Messaging: the topic is the label of the edges to and from the broker
        const destination = attributes['messaging.destination.name'];
        if (destination && span.kind === 'PRODUCER') {
            const edge = edges.find(e => e.label === destination && isBroker(e.target));
            return edge ? { node: edge.target } : null;
        }
        if (destination && span.kind === 'CONSUMER') {
            const edge = edges.find(e => e.label === destination && isBroker(e.source));
            return edge ? { node: edge.target, via: edge.source } : null;
        }

        // Database
        const database = attributes['db.system.name'] || attributes['db.system'];
        if (database) {
            const stores = nodes.filter(n => n.kind === 'database');
            const store = stores.find(n => (n.technology || '').toLowerCase().includes(database.toLowerCase())) || stores[0];
            return store ? { node: store.id } : null;
        }

        // Code location, for example the method of a REST resource
        const code = attributes['code.function.name']
            || (attributes['code.namespace'] ? `${attributes['code.namespace']}.${attributes['code.function'] || ''}` : null);
        if (code) {
            const owner = nodes.filter(n => n.className && code.startsWith(n.className + '.'))
                .sort((a, b) => b.className.length - a.className.length)[0];
            if (owner) {
                return { node: owner.id };
            }
        }

        // Outgoing HTTP call
        const host = attributes['server.address'];
        if (span.kind === 'CLIENT' && host) {
            const port = attributes['server.port'];
            const service = nodes.find(n => n.id === `http:${host}${port ? ':' + port : ''}`)
                || nodes.find(n => n.layer === 'external' && (n.details || []).some(d => d.includes(host)));
            return service ? { node: service.id } : null;
        }

        // Incoming HTTP request
        const route = attributes['http.route'];
        if (span.kind === 'SERVER' && route) {
            const request = `${attributes['http.request.method'] || ''} ${route}`.trim();
            const endpoint = nodes.find(n => n.kind === 'rest-endpoint' && (n.details || []).includes(request))
                || nodes.find(n => n.kind === 'rest-endpoint' && (n.details || []).some(d => d.endsWith(' ' + route)));
            return endpoint ? { node: endpoint.id } : null;
        }

        // A span name with a class name, for example "1_org.acme.Report#run" for a scheduled method
        const named = nodes.find(n => n.className && (span.name.includes(n.className + '#')
            || span.name.includes(n.className + '.')
            || span.name.startsWith(n.className.substring(n.className.lastIndexOf('.') + 1) + '.')));
        return named ? { node: named.id } : null;
    }

    /**
     * @return the node ids on the cheapest path from one node to another, along the edges of the model, or the two
     *         nodes when no path exists. The path follows the direction of the edges when it can.
     */
    _path(from, to) {
        for (const directed of [true, false]) {
            const cost = new Map([[from, 0]]);
            const previous = new Map([[from, null]]);
            const open = new Set([from]);
            while (open.size > 0) {
                const id = [...open].reduce((a, b) => cost.get(a) <= cost.get(b) ? a : b);
                open.delete(id);
                if (id === to) {
                    const path = [];
                    for (let at = to; at !== null; at = previous.get(at)) {
                        path.unshift(at);
                    }
                    return path;
                }
                for (const edge of this._model.edges) {
                    const next = edge.source === id ? edge.target : (!directed && edge.target === id ? edge.source : null);
                    const total = cost.get(id) + (ROUTE_COSTS[edge.kind] || 1);
                    if (next && (!cost.has(next) || total < cost.get(next))) {
                        cost.set(next, total);
                        previous.set(next, id);
                        open.add(next);
                    }
                }
            }
        }
        return [from, to];
    }

    /**
     * Draws the route of the current step over the edges, one path for each hop, in the order of the replay.
     */
    _renderReplayRoute(layout) {
        const step = this._currentStep();
        if (!step) {
            return nothing;
        }
        const hops = [];
        for (let i = 0; i < step.path.length - 1; i++) {
            const a = step.path[i], b = step.path[i + 1];
            const edge = layout.edges.find(e => e.source === a && e.target === b)
                || layout.edges.find(e => e.source === b && e.target === a);
            const source = edge && layout.byId.get(edge.source), target = edge && layout.byId.get(edge.target);
            if (source && target) {
                const path = edge.points ? this._routePath(edge.points) : this._edgePath(source, target, edge.offset || 0);
                hops.push(svg`<path class="replay-route" d="${path.d}" data-reverse="${edge.source !== a}"></path>`);
            }
        }
        return svg`${hops}<circle class="replay-dot" r="7" cx="-100" cy="-100"></circle>`;
    }

    /**
     * Shows the duration of each replayed span above its node.
     */
    _renderReplayMarks(layout) {
        const replay = this._replay;
        if (!replay || replay.index < 0) {
            return nothing;
        }
        const marks = new Map();
        for (const step of replay.steps.slice(0, replay.index + 1)) {
            marks.set(step.node, step);
        }
        return [...marks.values()].map(step => {
            const node = layout.byId.get(step.node);
            if (!node) {
                return nothing;
            }
            const text = this._formatMillis(step.duration);
            const width = text.length * 6.6 + 14;
            const x = node.x + (node.width || NODE_WIDTH) / 2;
            return svg`<rect class="replay-pill ${step.error ? 'error' : ''}" x="${x - width / 2}" y="${node.y - 22}" width="${width}" height="18" rx="9"></rect>
                <text class="replay-pill-text" x="${x}" y="${node.y - 9.5}" text-anchor="middle">${text}</text>`;
        });
    }

    /**
     * Moves the dot along the route of the current step, once for each new step.
     */
    _animateStep() {
        const replay = this._replay;
        const step = this._currentStep();
        const key = step ? `${replay.trace.traceId}/${replay.index}` : null;
        if (key === this._animatedStep) {
            return;
        }
        this._animatedStep = key;
        cancelAnimationFrame(this._replayFrame);
        const dot = this.shadowRoot.querySelector('.replay-dot');
        const routes = [...this.shadowRoot.querySelectorAll('.replay-route')];
        if (!dot || routes.length === 0) {
            return;
        }
        const lengths = routes.map(r => r.getTotalLength());
        const begin = performance.now();
        const frame = now => {
            const progress = Math.min(1, (now - begin) / (routes.length * HOP_MILLIS));
            const hop = Math.min(routes.length - 1, Math.floor(progress * routes.length));
            const local = progress * routes.length - hop;
            const along = routes[hop].dataset.reverse === 'true' ? 1 - Math.min(1, local) : Math.min(1, local);
            const point = routes[hop].getPointAtLength(along * lengths[hop]);
            dot.setAttribute('cx', point.x);
            dot.setAttribute('cy', point.y);
            if (progress < 1) {
                this._replayFrame = requestAnimationFrame(frame);
            }
        };
        this._replayFrame = requestAnimationFrame(frame);
    }

    _renderReplay() {
        const replay = this._replay;
        return html`<div class="details replay">
            <h3>${msg('Trace replay', { id: 'architecture-replay-title' })}
                <vaadin-button theme="icon tertiary small" @click=${this._closeReplay}>
                    <vaadin-icon icon="font-awesome-solid:xmark"></vaadin-icon>
                </vaadin-button>
            </h3>
            ${replay.trace ? this._renderReplaySteps() : this._renderTraceList()}
        </div>`;
    }

    _renderTraceList() {
        const replay = this._replay;
        if (!replay.available && !replay.file) {
            return html`<span class="kind">${msg('Add the OpenTelemetry extension (quarkus-opentelemetry) to replay the traces of the application.', { id: 'architecture-replay-no-otel' })}</span>
                ${this._renderImportButton()}`;
        }
        const all = replay.traces === null ? null : this._entryTraces();
        const traces = all === null ? null : this._visibleTraces();
        return html`
            <div class="replay-buttons">
                ${replay.file
                    ? replay.available ? html`<vaadin-button theme="tertiary small" @click=${this._showLiveTraces}>
                        <vaadin-icon icon="font-awesome-solid:satellite-dish" slot="prefix"></vaadin-icon>${msg('Live traces', { id: 'architecture-import-live' })}
                    </vaadin-button>` : nothing
                    : html`<vaadin-button theme="tertiary small" @click=${this._loadTraces}>
                        <vaadin-icon icon="font-awesome-solid:rotate" slot="prefix"></vaadin-icon>${msg('Refresh', { id: 'architecture-replay-refresh' })}
                    </vaadin-button>`}
                ${this._renderImportButton()}
            </div>
            ${replay.file ? html`<span class="kind">${msg(str`File: ${replay.file.name}`, { id: 'architecture-import-file' })}</span>
                ${replay.file.warnings.map(w => html`<span class="kind warning">${w}</span>`)}` : nothing}
            <vaadin-text-field theme="small" clear-button-visible placeholder="${msg('Filter: trace id, span name or attribute value', { id: 'architecture-replay-filter' })}"
                .value=${replay.filter} @value-changed=${e => this._filterTraces(e.detail.value)}></vaadin-text-field>
            <vaadin-checkbox label="${msg('Show all the traces on the diagram', { id: 'architecture-traffic' })}"
                .checked=${!!this._traffic} @checked-changed=${e => this._showTraffic(e.detail.value)}></vaadin-checkbox>
            ${this._renderTrafficTable()}
            ${traces === null ? html`<span class="kind">${msg('Loading the traces', { id: 'architecture-replay-loading' })}</span>`
                : traces.length === 0 ? html`<span class="kind">${replay.filter
                    ? msg('No trace matches the filter.', { id: 'architecture-replay-no-match' })
                    : replay.file ? msg('The file has no traces.', { id: 'architecture-import-empty' })
                    : msg('No traces yet. Call the application, then refresh.', { id: 'architecture-replay-empty' })}</span>`
                : html`<ul>${traces.map(trace => {
                    const root = this._rootOf(trace);
                    return html`<li class="${root && root.statusCode === 'ERROR' ? 'error' : ''}" @click=${() => this._selectTrace(trace)}>
                        ${root ? root.name : trace.traceId}<span class="duration">${root ? this._formatMillis(root.durationNanos / 1e6) : ''}</span>
                        <span class="span-name">${root ? new Date(root.startEpochNanos / 1e6).toLocaleTimeString() : ''} · ${trace.spans.length} spans</span>
                    </li>`;
                })}</ul>`}
            ${all && replay.traces.length > all.length ? html`<span class="kind">${msg(str`${replay.traces.length - all.length} traces without an entry point are hidden.`, { id: 'architecture-replay-hidden' })}</span>` : nothing}`;
    }

    _renderImportButton() {
        return html`<input type="file" id="trace-file" hidden accept=".json,.jsonl,.ndjson,application/json"
                @change=${e => { this._importFile(e.target.files[0]); e.target.value = ''; }}>
            <vaadin-button theme="tertiary small" title="${msg('Load the traces of an OTLP JSON file. The file stays in the browser.', { id: 'architecture-import-title' })}"
                @click=${() => this.shadowRoot.querySelector('#trace-file').click()}>
                <vaadin-icon icon="font-awesome-solid:file-import" slot="prefix"></vaadin-icon>${msg('Import a file', { id: 'architecture-import' })}
            </vaadin-button>`;
    }

    _renderReplaySteps() {
        const replay = this._replay;
        const root = this._rootOf(replay.trace);
        const name = id => {
            const node = this._model.nodes.find(n => n.id === id);
            return node ? node.name : id;
        };
        return html`
            <span class="kind">${root ? root.name : ''} · ${root ? this._formatMillis(root.durationNanos / 1e6) : ''}</span>
            <div class="replay-buttons">
                <vaadin-button theme="icon tertiary small" title="${msg('All traces', { id: 'architecture-replay-back' })}"
                    @click=${() => { this._stopReplay(); this._replay = { ...replay, trace: null, steps: [], index: -1, playing: false }; }}>
                    <vaadin-icon icon="font-awesome-solid:list"></vaadin-icon>
                </vaadin-button>
                <vaadin-button theme="icon tertiary small" title="${msg('Previous step', { id: 'architecture-replay-previous' })}" @click=${() => this._stepTo(replay.index - 1)}>
                    <vaadin-icon icon="font-awesome-solid:backward-step"></vaadin-icon>
                </vaadin-button>
                ${replay.playing
                    ? html`<vaadin-button theme="icon tertiary small" title="${msg('Pause', { id: 'architecture-replay-pause' })}" @click=${this._pause}>
                        <vaadin-icon icon="font-awesome-solid:pause"></vaadin-icon></vaadin-button>`
                    : html`<vaadin-button theme="icon tertiary small" title="${msg('Play', { id: 'architecture-replay-play' })}" @click=${this._play}>
                        <vaadin-icon icon="font-awesome-solid:play"></vaadin-icon></vaadin-button>`}
                <vaadin-button theme="icon tertiary small" title="${msg('Next step', { id: 'architecture-replay-next' })}" @click=${() => this._stepTo(replay.index + 1)}>
                    <vaadin-icon icon="font-awesome-solid:forward-step"></vaadin-icon>
                </vaadin-button>
            </div>
            ${replay.steps.length === 0
                ? html`<span class="kind">${msg('No span of this trace matches a component.', { id: 'architecture-replay-no-steps' })}</span>`
                : html`<ol>${replay.steps.map((step, i) => html`
                    <li class="${i === replay.index ? 'current' : i > replay.index ? 'pending' : ''} ${step.error ? 'error' : ''}" @click=${() => this._stepTo(i)}>
                        ${step.from ? `${name(step.from)} → ` : ''}${name(step.node)}
                        <span class="duration">+${this._formatMillis(step.offset)} · ${this._formatMillis(step.duration)}</span>
                        <span class="span-name">${step.span.name}</span>
                    </li>`)}</ol>`}`;
    }

    /**
     * @return the traces that start at an entry point. Traces that start with an outgoing call, like the schema
     *         creation at startup, are left out.
     */
    _entryTraces() {
        return (this._replay && this._replay.traces || []).filter(t => {
            const root = this._rootOf(t);
            return root && root.kind !== 'CLIENT' && root.kind !== 'PRODUCER';
        });
    }

    /**
     * @return the traces that start at an entry point and match the filter. A trace matches when its id, the name
     *         of one of its spans or the value of one of its attributes contains the filter.
     */
    _visibleTraces() {
        const filter = (this._replay && this._replay.filter || '').trim().toLowerCase();
        const traces = this._entryTraces();
        if (!filter) {
            return traces;
        }
        return traces.filter(trace => trace.traceId.includes(filter) || trace.spans.some(span =>
                span.name.toLowerCase().includes(filter)
                || Object.values(span.attributes || {}).some(value => String(value).toLowerCase().includes(filter))));
    }

    /**
     * Shows or hides the traffic of all the traces on the diagram. While it shows, new spans reload the traces.
     */
    _showTraffic(show) {
        if (this._spanStream) {
            this._spanStream.cancel();
            this._spanStream = null;
        }
        clearTimeout(this._trafficReload);
        if (!show || !this._replay || !this._replay.available && !this._replay.file) {
            this._traffic = null;
            this.requestUpdate();
            return;
        }
        this._selected = null;
        this._traffic = this._trafficOf(this._visibleTraces());
        if (!this._replay.file) {
            this._spanStream = this._otel.streamSpans().onNext(() => {
                clearTimeout(this._trafficReload);
                this._trafficReload = setTimeout(() => this._loadTraces(), TRAFFIC_RELOAD_MILLIS);
            });
        }
        this.requestUpdate();
    }

    /**
     * Adds up the replay steps of many traces: the number of calls on each edge, and the durations and errors of
     * the spans of each node.
     */
    _trafficOf(traces) {
        const edges = new Map();
        const edgeNodes = new Set();
        const nodes = new Map();
        for (const trace of traces) {
            for (const step of this._stepsOf(trace)) {
                for (let i = 0; i < step.path.length - 1; i++) {
                    const a = step.path[i], b = step.path[i + 1];
                    const edge = this._model.edges.find(e => e.source === a && e.target === b)
                        || this._model.edges.find(e => e.source === b && e.target === a);
                    if (edge) {
                        const key = `${edge.source}\n${edge.target}`;
                        edges.set(key, (edges.get(key) || 0) + 1);
                        edgeNodes.add(a);
                        edgeNodes.add(b);
                    }
                }
                const stats = nodes.get(step.node) || { durations: [], errors: 0 };
                stats.durations.push(step.duration);
                stats.errors += step.error ? 1 : 0;
                nodes.set(step.node, stats);
            }
        }
        for (const stats of nodes.values()) {
            stats.durations.sort((a, b) => a - b);
            stats.p50 = this._percentile(stats.durations, 50);
            stats.p95 = this._percentile(stats.durations, 95);
        }
        return {
            traces: traces.length, edges, edgeNodes, nodes,
            maxEdge: Math.max(1, ...edges.values()),
            maxP95: Math.max(0, ...[...nodes.values()].map(n => n.p95))
        };
    }

    /**
     * @return the nearest-rank percentile of sorted values
     */
    _percentile(sorted, percent) {
        return sorted.length === 0 ? 0 : sorted[Math.max(0, Math.ceil(percent / 100 * sorted.length) - 1)];
    }

    /**
     * Shows the number of spans and their p50 and p95 durations above each node. The colour goes from orange to
     * red with the p95 duration.
     */
    _renderTrafficMarks(layout) {
        if (!this._traffic) {
            return nothing;
        }
        return [...this._traffic.nodes.entries()].map(([id, stats]) => {
            const node = layout.byId.get(id);
            if (!node) {
                return nothing;
            }
            const text = `${stats.durations.length}× · p50 ${this._formatMillis(stats.p50)} · p95 ${this._formatMillis(stats.p95)}`;
            const width = text.length * 6.1 + 14;
            const x = node.x + (node.width || NODE_WIDTH) / 2;
            const heat = this._traffic.maxP95 > 0 ? stats.p95 / this._traffic.maxP95 : 0;
            const fill = stats.errors > 0 ? 'var(--lumo-error-color, #e53935)' : `hsl(${36 - 36 * heat}, 95%, ${48 - 6 * heat}%)`;
            return svg`<rect x="${x - width / 2}" y="${node.y - 22}" width="${width}" height="18" rx="9" fill="${fill}">
                    <title>${stats.errors > 0 ? `${stats.errors} errors` : ''}</title></rect>
                <text class="traffic-pill-text" x="${x}" y="${node.y - 9.5}" text-anchor="middle">${text}</text>`;
        });
    }

    _renderTrafficTable() {
        const traffic = this._traffic;
        if (!traffic) {
            return nothing;
        }
        const rows = [...traffic.nodes.entries()].sort((a, b) => b[1].p95 - a[1].p95);
        const name = id => {
            const node = this._model.nodes.find(n => n.id === id);
            return node ? node.name : id;
        };
        return html`
            <span class="kind">${msg(str`${traffic.traces} traces`, { id: 'architecture-traffic-count' })}</span>
            ${rows.length === 0 ? nothing : html`<table>
                <tr><th></th><th>${msg('Calls', { id: 'architecture-traffic-calls' })}</th><th>p50 ms</th><th>p95 ms</th><th>${msg('Errors', { id: 'architecture-traffic-errors' })}</th></tr>
                ${rows.map(([id, stats]) => html`<tr>
                    <td><span class="link" @click=${(e) => this._select(e, id)}>${name(id)}</span></td>
                    <td>${stats.durations.length}</td>
                    <td>${this._formatNumber(stats.p50)}</td>
                    <td>${this._formatNumber(stats.p95)}</td>
                    <td class="${stats.errors > 0 ? 'error' : ''}">${stats.errors}</td>
                </tr>`)}
            </table>`}`;
    }

    _rootOf(trace) {
        const ids = new Set(trace.spans.map(s => s.spanId));
        return trace.spans.filter(s => !ids.has(s.parentSpanId))
            .sort((a, b) => a.startEpochNanos - b.startEpochNanos)[0] || null;
    }

    _formatMillis(millis) {
        return `${this._formatNumber(millis)} ms`;
    }

    _formatNumber(millis) {
        return millis < 10 ? millis.toFixed(1) : String(Math.round(millis));
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

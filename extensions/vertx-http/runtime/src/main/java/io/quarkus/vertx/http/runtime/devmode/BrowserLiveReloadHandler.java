package io.quarkus.vertx.http.runtime.devmode;

import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.jboss.logging.Logger;

import io.vertx.core.Context;
import io.vertx.core.Handler;
import io.vertx.core.http.HttpHeaders;
import io.vertx.core.http.HttpServerResponse;
import io.vertx.ext.web.RoutingContext;

/**
 * Keeps the browsers connected to the live reload event stream and notifies them of changes.
 * <p>
 * The connections are held in static state so that they survive the restarts of the application in development
 * mode, as the class is loaded by the class loader that is not restarted.
 */
public class BrowserLiveReloadHandler implements Handler<RoutingContext> {

    private static final Logger LOG = Logger.getLogger(BrowserLiveReloadHandler.class);

    private static final Map<HttpServerResponse, Context> CONNECTIONS = new ConcurrentHashMap<>();

    @Override
    public void handle(RoutingContext ctx) {
        HttpServerResponse response = ctx.response();
        response.putHeader(HttpHeaders.CONTENT_TYPE, "text/event-stream")
                .putHeader(HttpHeaders.CACHE_CONTROL, "no-cache")
                .putHeader(HttpHeaders.CONNECTION, "keep-alive")
                .setChunked(true);
        response.closeHandler(v -> CONNECTIONS.remove(response));
        CONNECTIONS.put(response, ctx.vertx().getOrCreateContext());
        response.write("event: connected\ndata:\n\n");
    }

    private static String jsonArray(Collection<String> values) {
        StringBuilder sb = new StringBuilder("[");
        for (String value : values) {
            if (sb.length() > 1) {
                sb.append(',');
            }
            sb.append('"').append(value.replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
        }
        return sb.append(']').toString();
    }

    public static boolean hasConnections() {
        return !CONNECTIONS.isEmpty();
    }

    /**
     * Notifies the connected browsers of changes that do not require a restart of the application.
     *
     * @param staticResources the paths, relative to the root of the static resources, of the changed static resources
     * @param others the other changed files, relative to the resources of the application, e.g. templates
     */
    public static void notifyChanges(Collection<String> staticResources, Collection<String> others) {
        // built by hand: the Vert.x JSON support looks up its factory with the context class loader, which is not
        // the one of the application when this is called from the file system watcher
        String event = "event: change\ndata: {\"staticResources\":" + jsonArray(staticResources) + ",\"others\":"
                + jsonArray(others) + "}\n\n";
        LOG.debugf("Notifying %d browser(s) of changes: static resources %s, others %s", CONNECTIONS.size(),
                staticResources, others);
        for (Map.Entry<HttpServerResponse, Context> connection : CONNECTIONS.entrySet()) {
            HttpServerResponse response = connection.getKey();
            if (response.closed()) {
                CONNECTIONS.remove(response);
            } else {
                // the event stream may only be written from the context of its connection
                connection.getValue().runOnContext(v -> {
                    if (!response.closed()) {
                        response.write(event);
                    }
                });
            }
        }
    }
}

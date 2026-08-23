package io.quarkus.vertx.http.runtime.devmode;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

import io.vertx.core.Handler;
import io.vertx.core.http.HttpHeaders;
import io.vertx.ext.web.RoutingContext;

/**
 * Serves the script that connects a page to the live reload event stream.
 */
public class BrowserLiveReloadScriptHandler implements Handler<RoutingContext> {

    private final String script;

    public BrowserLiveReloadScriptHandler(String eventStreamPath) {
        try (InputStream is = BrowserLiveReloadScriptHandler.class.getResourceAsStream("browser-live-reload.js")) {
            script = new String(is.readAllBytes(), StandardCharsets.UTF_8).replace("${eventStreamPath}", eventStreamPath);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public void handle(RoutingContext ctx) {
        ctx.response().putHeader(HttpHeaders.CONTENT_TYPE, "text/javascript;charset=UTF-8")
                .putHeader(HttpHeaders.CACHE_CONTROL, "no-cache")
                .end(script);
    }
}

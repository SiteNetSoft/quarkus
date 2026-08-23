package io.quarkus.vertx.http.runtime.devmode;

import io.quarkus.runtime.annotations.Recorder;
import io.vertx.core.Handler;
import io.vertx.ext.web.RoutingContext;

@Recorder
public class BrowserLiveReloadRecorder {

    public Handler<RoutingContext> eventStreamHandler() {
        return new BrowserLiveReloadHandler();
    }

    public Handler<RoutingContext> scriptHandler(String eventStreamPath) {
        return new BrowserLiveReloadScriptHandler(eventStreamPath);
    }
}

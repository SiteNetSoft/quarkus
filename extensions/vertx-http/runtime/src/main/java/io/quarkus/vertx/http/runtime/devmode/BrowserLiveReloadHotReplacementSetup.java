package io.quarkus.vertx.http.runtime.devmode;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import io.quarkus.dev.spi.HotReplacementContext;
import io.quarkus.dev.spi.HotReplacementSetup;
import io.quarkus.vertx.http.runtime.StaticResourcesRecorder;

/**
 * Forwards the changes that do not require a restart to the browsers connected to the live reload event stream.
 */
public class BrowserLiveReloadHotReplacementSetup implements HotReplacementSetup {

    @Override
    public void setupHotDeployment(HotReplacementContext context) {
        context.consumeNoRestartChanges(BrowserLiveReloadHotReplacementSetup::notifyBrowsers);
    }

    static void notifyBrowsers(Set<String> changedFiles) {
        if (!BrowserLiveReloadHandler.hasConnections()) {
            return;
        }
        List<String> staticResources = new ArrayList<>();
        List<String> others = new ArrayList<>();
        for (String file : changedFiles) {
            if (file.startsWith(StaticResourcesRecorder.META_INF_RESOURCES)) {
                staticResources.add(file.substring(StaticResourcesRecorder.META_INF_RESOURCES.length()));
            } else {
                others.add(file);
            }
        }
        BrowserLiveReloadHandler.notifyChanges(staticResources, others);
    }
}

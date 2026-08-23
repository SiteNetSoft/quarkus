package io.quarkus.vertx.http.deployment.devmode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

import org.jboss.logging.Logger;

import io.quarkus.bootstrap.workspace.SourceDir;
import io.quarkus.bootstrap.workspace.WorkspaceModule;
import io.quarkus.deployment.IsDevelopment;
import io.quarkus.deployment.annotations.BuildProducer;
import io.quarkus.deployment.annotations.BuildStep;
import io.quarkus.deployment.annotations.Consume;
import io.quarkus.deployment.annotations.ExecutionTime;
import io.quarkus.deployment.annotations.Record;
import io.quarkus.deployment.builditem.HotDeploymentWatchedFileBuildItem;
import io.quarkus.deployment.builditem.LiveReloadBuildItem;
import io.quarkus.deployment.dev.RuntimeUpdatesProcessor;
import io.quarkus.deployment.dev.filesystem.watch.FileChangeCallback;
import io.quarkus.deployment.dev.filesystem.watch.FileChangeEvent;
import io.quarkus.deployment.dev.filesystem.watch.WatchServiceFileSystemWatcher;
import io.quarkus.deployment.pkg.builditem.CurateOutcomeBuildItem;
import io.quarkus.vertx.http.deployment.NonApplicationRootPathBuildItem;
import io.quarkus.vertx.http.deployment.RouteBuildItem;
import io.quarkus.vertx.http.runtime.StaticResourcesRecorder;
import io.quarkus.vertx.http.runtime.VertxHttpBuildTimeConfig;
import io.quarkus.vertx.http.runtime.devmode.BrowserLiveReloadRecorder;

/**
 * In development mode, when {@code quarkus.http.browser-live-reload} is enabled, watches the static resources of the
 * application and notifies the connected browsers of their changes.
 */
public class BrowserLiveReloadProcessor {

    private static final Logger LOG = Logger.getLogger(BrowserLiveReloadProcessor.class);

    private static final String EVENT_STREAM_ROUTE = "browser-live-reload";
    private static final String SCRIPT_ROUTE = "browser-live-reload.js";

    // the watcher survives the restarts of the application, like the handler it notifies
    private static volatile StaticResourcesWatcher watcher;

    @BuildStep(onlyIf = IsDevelopment.class)
    @Record(ExecutionTime.RUNTIME_INIT)
    @Consume(LiveReloadBuildItem.class)
    void browserLiveReload(VertxHttpBuildTimeConfig httpBuildTimeConfig, CurateOutcomeBuildItem curateOutcome,
            NonApplicationRootPathBuildItem nonApplicationRootPath, BrowserLiveReloadRecorder recorder,
            BuildProducer<RouteBuildItem> routes, BuildProducer<HotDeploymentWatchedFileBuildItem> watchedFiles) {
        if (!httpBuildTimeConfig.browserLiveReload()) {
            return;
        }
        // changes to any static resource are reported to the hot replacement setup, without restarting
        watchedFiles.produce(HotDeploymentWatchedFileBuildItem.builder()
                .setRestartNeeded(false)
                .setLocationPredicate(location -> location.startsWith(StaticResourcesRecorder.META_INF_RESOURCES))
                .build());
        routes.produce(nonApplicationRootPath.routeBuilder()
                .route(EVENT_STREAM_ROUTE)
                .handler(recorder.eventStreamHandler())
                .build());
        routes.produce(nonApplicationRootPath.routeBuilder()
                .route(SCRIPT_ROUTE)
                .handler(recorder.scriptHandler(nonApplicationRootPath.resolvePath(EVENT_STREAM_ROUTE)))
                .build());
        watchStaticResources(curateOutcome);
    }

    private static void watchStaticResources(CurateOutcomeBuildItem curateOutcome) {
        WorkspaceModule module = curateOutcome.getApplicationModel().getApplicationModule();
        if (module == null) {
            return;
        }
        Set<Path> staticResourceDirs = new HashSet<>();
        for (SourceDir resourceDir : module.getMainSources().getResourceDirs()) {
            Path dir = resourceDir.getDir().resolve(StaticResourcesRecorder.META_INF_RESOURCES);
            if (Files.isDirectory(dir)) {
                staticResourceDirs.add(dir.toAbsolutePath());
            }
        }
        if (watcher == null) {
            watcher = new StaticResourcesWatcher(staticResourceDirs);
        } else {
            watcher.watch(staticResourceDirs);
        }
    }

    static final class StaticResourcesWatcher implements FileChangeCallback {

        private final WatchServiceFileSystemWatcher watcher = new WatchServiceFileSystemWatcher("Static resources watcher",
                true);
        private final Set<Path> watched = new HashSet<>();

        StaticResourcesWatcher(Set<Path> dirs) {
            watch(dirs);
        }

        synchronized void watch(Set<Path> dirs) {
            // only ever add directories: unwatching can deadlock with the JDK polling watch service
            for (Path dir : dirs) {
                if (watched.add(dir)) {
                    LOG.debugf("Watching static resources in %s", dir);
                    watcher.watchDirectoryRecursively(dir, this);
                }
            }
        }

        @Override
        public void handleChanges(Collection<FileChangeEvent> changes) {
            boolean fileChanged = false;
            for (FileChangeEvent change : changes) {
                if (!Files.isDirectory(change.getFile())) {
                    fileChanged = true;
                    break;
                }
            }
            if (!fileChanged || RuntimeUpdatesProcessor.INSTANCE == null) {
                return;
            }
            try {
                // the scan reports the changed static resources to the hot replacement setups, which notify the browsers
                RuntimeUpdatesProcessor.INSTANCE.doScan(false);
            } catch (Exception e) {
                LOG.debug("Failed to scan for changes after static resources changed", e);
            }
        }

    }
}

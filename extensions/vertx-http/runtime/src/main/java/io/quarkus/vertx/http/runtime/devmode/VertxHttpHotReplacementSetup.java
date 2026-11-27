package io.quarkus.vertx.http.runtime.devmode;

import java.lang.ref.WeakReference;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.LogManager;

import io.netty.handler.codec.http.HttpHeaderNames;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.quarkus.dev.ErrorPageGenerators;
import io.quarkus.dev.config.CurrentConfig;
import io.quarkus.dev.console.DevConsoleManager;
import io.quarkus.dev.spi.HotReplacementContext;
import io.quarkus.dev.spi.HotReplacementSetup;
import io.quarkus.vertx.core.runtime.QuarkusExecutorFactory;
import io.quarkus.vertx.core.runtime.VertxCoreRecorder;
import io.quarkus.vertx.http.runtime.VertxHttpRecorder;
import io.vertx.core.AsyncResult;
import io.vertx.core.Context;
import io.vertx.core.Handler;
import io.vertx.core.MultiMap;
import io.vertx.core.http.HttpConnection;
import io.vertx.core.http.HttpServerResponse;
import io.vertx.core.impl.NoStackTraceException;
import io.vertx.core.net.impl.ConnectionBase;
import io.vertx.ext.web.RoutingContext;

public class VertxHttpHotReplacementSetup implements HotReplacementSetup {

    private volatile long nextUpdate;
    private volatile Throwable tempDeploymentProblem;
    private HotReplacementContext hotReplacementContext;

    private static final long HOT_REPLACEMENT_INTERVAL = 2000;

    private static final String HEADER_NAME = "x-quarkus-hot-deployment-done";

    private static final String CONFIG_FIX = "io.quarkus.vertx-http.devmode.config.fix";

    @Override
    public void setupHotDeployment(HotReplacementContext context) {
        // ensure that Vert.x runs in dev mode, this prevents Vert.x from caching static resources
        System.setProperty("vertxweb.environment", "dev");
        this.hotReplacementContext = context;
        VertxHttpRecorder.setHotReplacement(this::handleHotReplacementRequest, hotReplacementContext);
        hotReplacementContext.addPreScanStep(new Runnable() {
            @Override
            public void run() {
                RemoteSyncHandler.doPreScan();
            }
        });
        hotReplacementContext.addPreRestartStep(new Runnable() {
            @Override
            public void run() {
                try {
                    // If not on a worker thread then attempt to re-initialize the dev mode executor
                    if (!Context.isOnWorkerThread()) {
                        QuarkusExecutorFactory.reinitializeDevModeExecutor();
                    }
                } finally {
                    // Mark the restart as started: requests now wait for the restarted application. Done here, not
                    // when the application stops (it also stops on exit and on dev mode shutdown), and only after the
                    // executor is re-initialized, as that rejects or drops the waiting requests queued on it
                    restartingFrom = new WeakReference<>(VertxHttpRecorder.getCurrentApplicationState());
                }
            }
        });
    }

    @Override
    public void handleFailedInitialStart() {
        //remove for vert.x 4.2
        //at the moment there is a TCCL error that is normally handled by the log filters
        //but if startup fails it may not take effect
        //it happens once per thread, so it can completely mess up the console output, and hide the real issue
        LogManager.getLogManager().getLogger("io.vertx.core.impl.ContextImpl").setLevel(Level.SEVERE);
        VertxHttpRecorder.startServerAfterFailedStart();
    }

    private static volatile Set<ConnectionBase> openConnections;

    /**
     * Connections with a request waiting in {@link #handleHotReplacementRequest} for a scan or a restart to complete.
     * They are not closed when the application stops: the request is dispatched to the restarted application once it
     * is up.
     */
    private static final Set<HttpConnection> waitingConnections = Collections.newSetFromMap(new ConcurrentHashMap<>());

    /**
     * The application state at the time the last restart of the application began. Until the restarted
     * application has installed its root handler, the state is still this one and requests must not be dispatched
     * to the handlers of the application being stopped.
     * <p>
     * Weak, so that the replaced application can be garbage collected: the current state references it strongly for
     * as long as the comparison can be true.
     */
    private static volatile WeakReference<Object> restartingFrom = new WeakReference<>(null);

    public static void handleDevModeRestart() {
        //close all connections, except those with a request waiting for the restart (including the one that triggered it)
        //this prevents long-running requests such as SSE or websockets
        //from holding onto the old deployment
        Set<ConnectionBase> cons = VertxHttpHotReplacementSetup.openConnections;
        if (cons != null) {
            for (ConnectionBase con : cons) {
                if (!waitingConnections.contains(con)) {
                    con.close();
                }
            }
        }
    }

    /**
     * Whether a restart that was not initiated by an HTTP request, for example one triggered by an extension watching
     * for changes, is in progress.
     */
    private static boolean isRestarting() {
        Object from = restartingFrom.get();
        return from != null && from == VertxHttpRecorder.getCurrentApplicationState();
    }

    /**
     * Whether requests must wait for a restart in progress.
     * <p>
     * Not with a deployment problem: a restart that failed at build time installs no root handler, so
     * {@link #isRestarting()} stays true, but requests get the error page and never reach the stopped application.
     * Waiting would make each of them scan, and a scan with a deployment problem always restarts.
     */
    private static boolean isRestartInProgress(Throwable deploymentProblem) {
        return deploymentProblem == null && isRestarting();
    }

    void handleHotReplacementRequest(RoutingContext routingContext) {
        // the application this request was dispatched to, to detect a restart (whatever triggers it) while it waits
        Object currentState = VertxHttpRecorder.getCurrentApplicationState();
        if (openConnections == null) {
            synchronized (VertxHttpHotReplacementSetup.class) {
                if (openConnections == null) {
                    openConnections = Collections.newSetFromMap(new ConcurrentHashMap<>());
                }
            }
        }
        var connection = routingContext.request().connection();
        if (connection instanceof ConnectionBase connectionBase) {
            if (openConnections.add(connectionBase)) {
                connectionBase.closeFuture().onComplete(new Handler<AsyncResult<Void>>() {
                    @Override
                    public void handle(AsyncResult<Void> event) {
                        openConnections.remove(connectionBase);
                    }
                });
            }
        }
        Throwable scanDeploymentProblem = tempDeploymentProblem;
        if (scanDeploymentProblem != null) {
            handleDeploymentProblem(routingContext, scanDeploymentProblem);
            return;
        }
        if (hotReplacementContext.getDeploymentProblem() != null && routingContext.request().path().endsWith(CONFIG_FIX)) {

            routingContext.request().setExpectMultipart(true);
            routingContext.request().endHandler(new Handler<Void>() {
                @Override
                public void handle(Void event) {
                    VertxCoreRecorder.getVertx().get().getOrCreateContext().executeBlocking(new Callable<Void>() {
                        @Override
                        public Void call() {
                            String redirect = "/";
                            MultiMap attrs = routingContext.request().formAttributes();
                            Map<String, String> newVals = new HashMap<>();
                            for (Map.Entry<String, String> i : attrs) {
                                if (i.getKey().startsWith("key.")) {
                                    newVals.put(i.getKey().substring("key.".length()), i.getValue());
                                } else if (i.getKey().equals("redirect")) {
                                    redirect = i.getValue();
                                }
                            }
                            CurrentConfig.EDITOR.accept(newVals);
                            routingContext.response().setStatusCode(HttpResponseStatus.SEE_OTHER.code()).headers()
                                    .set(HttpHeaderNames.LOCATION, redirect);
                            routingContext.response().end();
                            return null;
                        }
                    }, false).onFailure(routingContext::fail);
                }
            });
            routingContext.request().resume();
            return;
        }
        // read once: a new restart attempt clears it right after stopping the application, a second read could let
        // the request reach the stopped one
        Throwable deploymentProblem = hotReplacementContext.getDeploymentProblem();
        if (((nextUpdate > System.currentTimeMillis() &&
                !hotReplacementContext.isTest() &&
                !DevConsoleManager.isDoingHttpInitiatedReload()) // if there is a live reload possibly going on we don't want to let a request through to restarting application, this is best effort, but it narrows the window a lot
                || routingContext.request().headers().contains(HEADER_NAME))
                // also when dispatched again after a restart: another one may have started
                && !isRestartInProgress(deploymentProblem)) {
            if (deploymentProblem != null) {
                handleDeploymentProblem(routingContext, deploymentProblem);
                return;
            }
            routingContext.next();
            return;
        }
        // We need to set the flag immediately after the check to mitigate
        // the timing issue when multiple requests are processed concurrently
        DevConsoleManager.setDoingHttpInitiatedReload(true);
        waitingConnections.add(connection);
        try {
            ClassLoader current = Thread.currentThread().getContextClassLoader();
            VertxCoreRecorder.getVertx().get().getOrCreateContext().executeBlocking(new Callable<Boolean>() {
                @Override
                public Boolean call() {
                    //the blocking pool may have a stale TCCL
                    Thread.currentThread().setContextClassLoader(current);
                    boolean restart = false;
                    synchronized (VertxHttpHotReplacementSetup.this) {
                        // a restart triggered by another source is waited for through the scan lock, whatever the
                        // time of the last scan
                        // the deployment problem is read again: requests queued on this monitor during a failed restart
                        // must not each retry it
                        if (nextUpdate < System.currentTimeMillis() || hotReplacementContext.isTest()
                                || isRestartInProgress(hotReplacementContext.getDeploymentProblem())) {
                            nextUpdate = System.currentTimeMillis() + HOT_REPLACEMENT_INTERVAL;
                            try {
                                tempDeploymentProblem = hotReplacementContext.getDeploymentProblem();
                                restart = hotReplacementContext.doScan(true);
                            } catch (Exception e) {
                                throw new IllegalStateException("Unable to perform live reload scanning", e);
                            } finally {
                                tempDeploymentProblem = null;
                            }
                        }
                    }
                    if (hotReplacementContext.getDeploymentProblem() != null) {
                        throw new NoStackTraceException(hotReplacementContext.getDeploymentProblem());
                    }
                    // the connections were closed by handleDevModeRestart()
                    return restart;
                }
            }, false).onComplete(new Handler<AsyncResult<Boolean>>() {
                @Override
                public void handle(AsyncResult<Boolean> result) {
                    // Unset the flag when the blocking code completes
                    DevConsoleManager.setDoingHttpInitiatedReload(false);
                    waitingConnections.remove(connection);
                    if (result.failed()) {
                        handleDeploymentProblem(routingContext, result.cause());
                    } else {
                        boolean restartedByThisRequest = result.result();
                        boolean restart = restartedByThisRequest;
                        // checked on the event loop, right before dispatching:
                        //its possible a Kafka message or some other source triggered a reload,
                        //so we could wait for the restart (due to the scan lock)
                        //but then fail to dispatch to the new application
                        if (currentState != VertxHttpRecorder.getCurrentApplicationState()) {
                            restart = true;
                        }
                        if (restart) {
                            if (restartedByThisRequest) {
                                // once per restart: it drops the queued tasks of the other waiting requests
                                // (a restart from another thread did it in the pre-restart step)
                                QuarkusExecutorFactory.reinitializeDevModeExecutor();
                            }
                            routingContext.request().headers().set(HEADER_NAME, "true");
                            VertxHttpRecorder.getRootHandler().handle(routingContext.request());
                        } else {
                            routingContext.next();
                        }
                    }
                }
            });
        } catch (Throwable e) {
            // Make sure the flag is unset when something bad happens
            DevConsoleManager.setDoingHttpInitiatedReload(false);
            waitingConnections.remove(connection);
            throw e;
        }

    }

    public static void handleDeploymentProblem(RoutingContext routingContext, final Throwable exception) {
        String bodyText = ReplacementDebugPage.generateHtml(exception, routingContext.request().absoluteURI());
        HttpServerResponse response = routingContext.response();
        response.setStatusCode(500);
        response.headers().add("Content-Type", "text/html; charset=UTF-8");
        response.end(bodyText);
    }

    @Override
    public void close() {
        ErrorPageGenerators.clear();
        VertxHttpRecorder.shutDownDevMode();
    }
}

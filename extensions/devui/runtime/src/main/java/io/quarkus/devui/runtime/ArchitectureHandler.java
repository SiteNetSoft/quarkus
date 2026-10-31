package io.quarkus.devui.runtime;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;

import io.vertx.core.Handler;
import io.vertx.core.buffer.Buffer;
import io.vertx.ext.web.RoutingContext;

/**
 * Serves one of the architecture documents that the build generates, for example {@code /q/arch}.
 */
public class ArchitectureHandler implements Handler<RoutingContext> {

    private String resource;
    private String contentType;

    public ArchitectureHandler() {
    }

    public ArchitectureHandler(String resource, String contentType) {
        this.resource = resource;
        this.contentType = contentType;
    }

    public String getResource() {
        return resource;
    }

    public void setResource(String resource) {
        this.resource = resource;
    }

    public String getContentType() {
        return contentType;
    }

    public void setContentType(String contentType) {
        this.contentType = contentType;
    }

    @Override
    public void handle(RoutingContext event) {
        byte[] content = read();
        if (content == null) {
            event.response().setStatusCode(404).end();
            return;
        }
        event.response()
                .putHeader("Content-Type", contentType)
                .end(Buffer.buffer(content));
    }

    private byte[] read() {
        try (InputStream in = Thread.currentThread().getContextClassLoader().getResourceAsStream(resource)) {
            return in == null ? null : in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}

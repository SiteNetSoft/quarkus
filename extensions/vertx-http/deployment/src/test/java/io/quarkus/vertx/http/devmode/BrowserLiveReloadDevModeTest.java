package io.quarkus.vertx.http.devmode;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.awaitility.Awaitility;
import org.jboss.shrinkwrap.api.asset.StringAsset;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

import io.quarkus.test.QuarkusDevModeTest;
import io.restassured.RestAssured;

/**
 * With {@code quarkus.http.browser-live-reload} enabled, a browser connected to the event stream is notified when a
 * static resource changes.
 * See <a href="https://github.com/quarkusio/quarkus/issues/1418">GitHub issue #1418</a>.
 */
public class BrowserLiveReloadDevModeTest {

    @RegisterExtension
    final static QuarkusDevModeTest test = new QuarkusDevModeTest()
            .withApplicationRoot((jar) -> jar
                    .add(new StringAsset("quarkus.http.browser-live-reload=true\n"), "application.properties")
                    .add(new StringAsset("<html><body>Hello<script src=\"/q/browser-live-reload.js\"></script></body></html>"),
                            "META-INF/resources/index.html")
                    .add(new StringAsset("body { color: red; }"), "META-INF/resources/css/app.css"));

    @Test
    public void scriptIsServed() {
        RestAssured.get("/q/browser-live-reload.js").then()
                .statusCode(200)
                .contentType("text/javascript")
                .body(org.hamcrest.Matchers.containsString("new EventSource(\"/q/browser-live-reload\")"));
    }

    @Test
    public void changedStaticResourcesAreNotifiedToTheEventStream() throws Exception {
        List<String> events = new ArrayList<>();
        CountDownLatch connected = new CountDownLatch(1);
        Thread reader = new Thread(() -> {
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(
                        RestAssured.baseURI + ":" + RestAssured.port + "/q/browser-live-reload")
                        .openConnection();
                connection.setReadTimeout((int) Duration.ofSeconds(30).toMillis());
                try (BufferedReader in = new BufferedReader(
                        new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = in.readLine()) != null) {
                        if (line.equals("event: connected")) {
                            connected.countDown();
                        } else if (line.startsWith("data: {")) {
                            synchronized (events) {
                                events.add(line.substring("data: ".length()));
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
                // the stream is closed when the test ends
            }
        });
        reader.setDaemon(true);
        reader.start();
        assertThat(connected.await(30, TimeUnit.SECONDS)).as("connected to the event stream").isTrue();

        test.modifyResourceFile("META-INF/resources/css/app.css", s -> s.replace("red", "blue"));
        Awaitility.await().atMost(Duration.ofSeconds(30)).untilAsserted(() -> {
            synchronized (events) {
                assertThat(events).contains("{\"staticResources\":[\"/css/app.css\"],\"others\":[]}");
            }
        });

        test.modifyResourceFile("META-INF/resources/index.html", s -> s.replace("Hello", "Hi"));
        Awaitility.await().atMost(Duration.ofSeconds(30)).untilAsserted(() -> {
            synchronized (events) {
                assertThat(events).contains("{\"staticResources\":[\"/index.html\"],\"others\":[]}");
            }
        });
    }
}

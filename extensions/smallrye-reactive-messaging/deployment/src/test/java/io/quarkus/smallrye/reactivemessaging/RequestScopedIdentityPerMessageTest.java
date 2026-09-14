package io.quarkus.smallrye.reactivemessaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Flow;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.reactive.messaging.Incoming;
import org.eclipse.microprofile.reactive.messaging.Message;
import org.eclipse.microprofile.reactive.messaging.spi.Connector;
import org.jboss.shrinkwrap.api.asset.StringAsset;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

import io.quarkus.security.identity.CurrentIdentityAssociation;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.quarkus.test.QuarkusExtensionTest;
import io.smallrye.mutiny.Multi;
import io.smallrye.reactive.messaging.PublisherDecorator;
import io.smallrye.reactive.messaging.annotations.Blocking;
import io.smallrye.reactive.messaging.connector.InboundConnector;
import io.smallrye.reactive.messaging.providers.locals.ContextAwareMessage;
import io.vertx.core.Vertx;

/**
 * Scenario of quarkusio/quarkus#38244: a {@link PublisherDecorator} sets the current
 * {@link io.quarkus.security.identity.SecurityIdentity} per incoming connector message, and the
 * consumer of the message reads it back through {@link CurrentIdentityAssociation}.
 * With {@code quarkus.messaging.request-scoped.enabled=true} each message gets its own
 * request context, so the identity is the one set for that message.
 */
public class RequestScopedIdentityPerMessageTest {

    @RegisterExtension
    static final QuarkusExtensionTest config = new QuarkusExtensionTest()
            .withApplicationRoot((jar) -> jar
                    .addClasses(TestSource.class, IdentityDecorator.class, IdentityConsumer.class)
                    .addAsResource(new StringAsset(
                            "quarkus.messaging.request-scoped.enabled=true\n"
                                    + "mp.messaging.incoming.in.connector=test-identity-source\n"),
                            "application.properties"));

    @Inject
    IdentityConsumer consumer;

    @Test
    public void identitySetInDecoratorIsVisibleToTheConsumerOfTheSameMessage() {
        await().until(() -> consumer.seen().size() == TestSource.USERS.size());
        assertThat(consumer.seen()).containsOnlyKeys(TestSource.USERS);
        for (String user : TestSource.USERS) {
            assertThat(consumer.seen().get(user)).isEqualTo(user);
        }
    }

    @ApplicationScoped
    @Connector("test-identity-source")
    public static class TestSource implements InboundConnector {

        static final List<String> USERS = List.of("alice", "bob", "carol");

        @Inject
        Vertx vertx;

        @Override
        public Flow.Publisher<? extends Message<?>> getPublisher(Config config) {
            return Multi.createFrom().<Message<?>> emitter(emitter -> vertx.runOnContext(v -> {
                for (String user : USERS) {
                    emitter.emit(ContextAwareMessage.of(user));
                }
                emitter.complete();
            }));
        }
    }

    @ApplicationScoped
    public static class IdentityDecorator implements PublisherDecorator {

        @Inject
        CurrentIdentityAssociation identityAssociation;

        @Override
        public Multi<? extends Message<?>> decorate(Multi<? extends Message<?>> publisher, List<String> channelName,
                boolean isConnector) {
            if (!isConnector) {
                return publisher;
            }
            return publisher.map(message -> {
                String user = (String) message.getPayload();
                identityAssociation.setIdentity(QuarkusSecurityIdentity.builder()
                        .setPrincipal(new QuarkusPrincipal(user))
                        .build());
                return message;
            });
        }

        @Override
        public int getPriority() {
            return 200;
        }
    }

    @ApplicationScoped
    public static class IdentityConsumer {

        private final Map<String, String> seen = new ConcurrentHashMap<>();

        @Inject
        CurrentIdentityAssociation identityAssociation;

        @Incoming("in")
        @Blocking(ordered = false)
        public void consume(String payload) throws InterruptedException {
            Thread.sleep(300);
            seen.put(payload, identityAssociation.getIdentity().getPrincipal().getName());
        }

        public Map<String, String> seen() {
            return seen;
        }
    }
}

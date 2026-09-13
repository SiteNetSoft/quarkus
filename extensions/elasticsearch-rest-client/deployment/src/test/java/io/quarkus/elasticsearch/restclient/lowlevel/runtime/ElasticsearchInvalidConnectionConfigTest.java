package io.quarkus.elasticsearch.restclient.lowlevel.runtime;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import io.quarkus.runtime.configuration.ConfigurationException;
import io.smallrye.config.SmallRyeConfig;
import io.smallrye.config.SmallRyeConfigBuilder;

public class ElasticsearchInvalidConnectionConfigTest {

    @ParameterizedTest
    @CsvSource({
            "quarkus.elasticsearch.max-connections, 0",
            "quarkus.elasticsearch.max-connections, -1",
            "quarkus.elasticsearch.max-connections-per-route, 0",
            "quarkus.elasticsearch.max-connections-per-route, -5",
            "quarkus.elasticsearch.io-thread-counts, 0",
            "quarkus.elasticsearch.io-thread-counts, -1",
    })
    public void nonPositiveValuesAreRejected(String property, String value) {
        ElasticsearchConfig config = config(property, value);

        ConfigurationException exception = assertThrows(ConfigurationException.class,
                () -> RestClientBuilderHelper.createRestClientBuilder(config));

        assertTrue(exception.getMessage().contains(property), exception.getMessage());
        assertTrue(exception.getMessage().contains(value), exception.getMessage());
    }

    @Test
    public void positiveValuesAreAccepted() {
        ElasticsearchConfig config = config("quarkus.elasticsearch.io-thread-counts", "2");

        assertDoesNotThrow(() -> RestClientBuilderHelper.createRestClientBuilder(config));
    }

    private static ElasticsearchConfig config(String property, String value) {
        SmallRyeConfig config = new SmallRyeConfigBuilder()
                .addDiscoveredConverters()
                .withMapping(ElasticsearchConfig.class)
                .withDefaultValue("quarkus.elasticsearch.hosts", "elasticsearch:9200")
                .withDefaultValue(property, value)
                .build();
        return config.getConfigMapping(ElasticsearchConfig.class);
    }
}

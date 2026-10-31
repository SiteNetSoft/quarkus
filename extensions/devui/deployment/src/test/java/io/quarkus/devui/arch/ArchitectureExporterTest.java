package io.quarkus.devui.arch;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

import io.quarkus.devui.deployment.arch.ArchitectureExporter;
import io.quarkus.devui.deployment.arch.ArchitectureModel;
import io.quarkus.devui.deployment.arch.ArchitectureModel.Edge;
import io.quarkus.devui.deployment.arch.ArchitectureModel.Node;

public class ArchitectureExporterTest {

    private static final ArchitectureModel MODEL = new ArchitectureModel("shop", "1.0", List.of(
            new Node("org.acme.OrderResource", "OrderResource", "rest-endpoint", Node.LAYER_ENTRY, "Jakarta REST",
                    "org.acme.OrderResource", List.of("GET /orders"), false),
            new Node("org.acme.Order", "Order", "entity", Node.LAYER_DATA, "Jakarta Persistence", "org.acme.Order",
                    List.of(), false),
            new Node("db:<default>", "PostgreSQL", "database", Node.LAYER_EXTERNAL, "PostgreSQL", null, List.of(), true),
            new Node("broker:kafka", "Kafka", "message-broker", Node.LAYER_EXTERNAL, "Kafka", null, List.of(), true)),
            List.of(new Edge("org.acme.OrderResource", "org.acme.Order", "uses", null),
                    new Edge("org.acme.Order", "db:<default>", "stored-in", null),
                    new Edge("org.acme.OrderResource", "broker:kafka", "publishes", "orders")));

    @Test
    public void testPlantUmlUsesTheC4Macros() {
        String plantUml = ArchitectureExporter.toPlantUml(MODEL);

        assertThat(plantUml)
                .contains("!include <C4/C4_Component>")
                .contains("SystemDb_Ext(db__default_, \"PostgreSQL\", \"PostgreSQL\")")
                .contains("SystemQueue_Ext(broker_kafka, \"Kafka\", \"Kafka\")")
                .contains("Container_Boundary(app, \"shop\")")
                .contains("Component(org_acme_OrderResource, \"OrderResource\", \"Jakarta REST\", \"rest-endpoint\")")
                .contains("ComponentDb(org_acme_Order, \"Order\"")
                .contains("Rel(org_acme_OrderResource, broker_kafka, \"publishes orders\")");
    }

    @Test
    public void testMermaidGroupsTheComponentsInTheApplication() {
        String mermaid = ArchitectureExporter.toMermaid(MODEL);

        assertThat(mermaid)
                .startsWith("flowchart LR\n    subgraph app[\"shop\"]\n")
                .contains("org_acme_Order[(")
                .contains("broker_kafka[[")
                .contains("org_acme_OrderResource -->|\"publishes orders\"| broker_kafka");
        assertThat(mermaid.indexOf("broker_kafka[[")).isGreaterThan(mermaid.indexOf("    end\n"));
    }
}

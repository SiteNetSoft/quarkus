package io.quarkus.devui.arch;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

import io.quarkus.devui.deployment.arch.ArchitectureExporter;
import io.quarkus.devui.deployment.arch.ArchitectureModel;
import io.quarkus.devui.deployment.arch.ArchitectureModel.Edge;
import io.quarkus.devui.deployment.arch.ArchitectureModel.Level;
import io.quarkus.devui.deployment.arch.ArchitectureModel.Node;

public class ArchitectureExporterTest {

    private static final ArchitectureModel MODEL = new ArchitectureModel("shop", "1.0", "3.99.0", List.of(
            new Node("org.acme.OrderResource", "OrderResource", "rest-endpoint", Node.LAYER_ENTRY, "Jakarta REST",
                    "org.acme.OrderResource", List.of("GET /orders"), false),
            new Node("org.acme.Order", "Order", "entity", Node.LAYER_DATA, "Jakarta Persistence", "org.acme.Order",
                    List.of(), false),
            new Node("db:<default>", "PostgreSQL", "database", Node.LAYER_EXTERNAL, "PostgreSQL", null, List.of(), true),
            new Node("broker:kafka", "Kafka", "message-broker", Node.LAYER_EXTERNAL, "Kafka", null, List.of(), true),
            new Node("http:payments:8080", "payments:8080", "http-service", Node.LAYER_EXTERNAL, "HTTP", null, List.of(),
                    false)),
            List.of(new Edge("org.acme.OrderResource", "org.acme.Order", "uses", null),
                    new Edge("org.acme.Order", "db:<default>", "stored-in", null),
                    new Edge("org.acme.OrderResource", "broker:kafka", "publishes", "orders"),
                    new Edge("org.acme.OrderResource", "http:payments:8080", "calls", "HTTP")));

    @Test
    public void testPlantUmlUsesTheC4Macros() {
        String plantUml = ArchitectureExporter.toPlantUml(MODEL);

        assertThat(plantUml)
                .contains("!include <C4/C4_Component>")
                .contains("ContainerDb(db__default_, \"PostgreSQL\", \"PostgreSQL\")")
                .contains("ContainerQueue(broker_kafka, \"Kafka\", \"Kafka\")")
                .contains("System_Ext(http_payments_8080, \"payments:8080\", \"HTTP\")")
                .contains("Container_Boundary(app, \"shop\")")
                .contains("Rel(user, org_acme_OrderResource, \"calls\")")
                .contains("Component(org_acme_OrderResource, \"OrderResource\", \"Jakarta REST\", \"rest-endpoint\")")
                .contains("ComponentDb(org_acme_Order, \"Order\"")
                .contains("Rel(org_acme_OrderResource, broker_kafka, \"publishes orders\")");
    }

    @Test
    public void testMermaidGroupsTheComponentsInTheApplication() {
        String mermaid = ArchitectureExporter.toMermaid(MODEL);

        assertThat(mermaid)
                .startsWith(
                        "flowchart LR\n    user([\"User\"])\n    subgraph system[\"shop\"]\n        subgraph app[\"shop\"]\n")
                .contains("org_acme_Order[(")
                .contains("broker_kafka[[")
                .contains("org_acme_OrderResource -->|\"publishes orders\"| broker_kafka");
        assertThat(mermaid.indexOf("broker_kafka[[")).isGreaterThan(mermaid.indexOf("        end\n"));
        assertThat(mermaid.indexOf("http_payments_8080{{")).isGreaterThan(mermaid.lastIndexOf("    end\n"));
    }

    @Test
    public void testContextFoldsTheComponentsAndContainersIntoTheSystem() {
        String plantUml = ArchitectureExporter.toPlantUml(MODEL, Level.CONTEXT);

        assertThat(plantUml)
                .contains("!include <C4/C4_Context>")
                .contains("Person(user, \"User\"")
                .contains("System(app, \"shop\", \"1 rest-endpoint, 1 entity\")")
                .contains("System_Ext(http_payments_8080")
                .contains("Rel(user, app, \"calls\")")
                .contains("Rel(app, http_payments_8080, \"calls HTTP\")")
                .doesNotContain("PostgreSQL")
                .doesNotContain("Kafka")
                .doesNotContain("OrderResource");
    }

    @Test
    public void testContainersShowTheApplicationNextToItsDataStores() {
        String plantUml = ArchitectureExporter.toPlantUml(MODEL, Level.CONTAINER);

        assertThat(plantUml)
                .contains("!include <C4/C4_Container>")
                .contains("System_Boundary(system, \"shop\")")
                .contains("Container(app, \"shop\", \"Quarkus 3.99.0\"")
                .contains("ContainerDb(db__default_, \"PostgreSQL\", \"PostgreSQL\")")
                .contains("Rel(app, db__default_, \"stored-in\")")
                .contains("Rel(app, broker_kafka, \"publishes orders\")")
                .contains("Rel(app, http_payments_8080, \"calls HTTP\")")
                .doesNotContain("OrderResource");
    }
}

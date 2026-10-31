package io.quarkus.devui.arch;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

import io.quarkus.arc.Unremovable;
import io.quarkus.test.QuarkusDevModeTest;
import io.restassured.RestAssured;
import io.restassured.path.json.JsonPath;

public class ArchitectureTest {

    @RegisterExtension
    static final QuarkusDevModeTest config = new QuarkusDevModeTest()
            .withApplicationRoot(jar -> jar.addClasses(Greeter.class, Formatter.class));

    @Test
    public void testModelListsTheBeansAndTheirInjections() {
        JsonPath model = RestAssured.get("q/arch").then().statusCode(200).contentType("application/json")
                .extract().jsonPath();

        List<Map<String, Object>> nodes = model.getList("nodes");
        assertThat(nodes).anySatisfy(node -> {
            assertThat(node).containsEntry("id", Greeter.class.getName());
            assertThat(node).containsEntry("kind", "bean");
            assertThat(node).containsEntry("layer", "logic");
        });
        assertThat(nodes).anySatisfy(node -> assertThat(node).containsEntry("id", Formatter.class.getName()));

        List<Map<String, Object>> edges = model.getList("edges");
        assertThat(edges).anySatisfy(edge -> {
            assertThat(edge).containsEntry("source", Greeter.class.getName());
            assertThat(edge).containsEntry("target", Formatter.class.getName());
            assertThat(edge).containsEntry("kind", "injects");
        });
    }

    @Test
    public void testDiagramsAreServed() {
        String plantUml = RestAssured.get("q/arch/plantuml").then().statusCode(200).extract().asString();
        assertThat(plantUml).startsWith("@startuml").contains("Component(").contains("Rel(").endsWith("@enduml\n");

        String mermaid = RestAssured.get("q/arch/mermaid").then().statusCode(200).extract().asString();
        assertThat(mermaid).startsWith("flowchart LR").contains("-->");

        for (String level : List.of("context", "container", "component")) {
            assertThat(RestAssured.get("q/arch/plantuml/" + level).then().statusCode(200).extract().asString())
                    .startsWith("@startuml");
            assertThat(RestAssured.get("q/arch/mermaid/" + level).then().statusCode(200).extract().asString())
                    .startsWith("flowchart LR");
        }
    }

    @Unremovable
    @ApplicationScoped
    public static class Greeter {

        @Inject
        Formatter formatter;

        public String greet(String name) {
            return formatter.format("Hello " + name);
        }
    }

    @ApplicationScoped
    public static class Formatter {

        public String format(String text) {
            return text + "!";
        }
    }
}

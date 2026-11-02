package io.quarkus.devui.deployment.arch;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import io.quarkus.devui.deployment.arch.ArchitectureModel.Edge;
import io.quarkus.devui.deployment.arch.ArchitectureModel.Level;
import io.quarkus.devui.deployment.arch.ArchitectureModel.Node;

/**
 * Writes an {@link ArchitectureModel} as text diagrams at one C4 {@link Level}: C4-PlantUML diagrams and Mermaid
 * flowcharts.
 */
public final class ArchitectureExporter {

    private static final String USER_ID = "user";
    private static final String SYSTEM_ID = "system";

    /**
     * Words of the Mermaid flowchart syntax that cannot be node ids.
     */
    private static final Set<String> MERMAID_KEYWORDS = Set.of("end", "subgraph", "graph", "flowchart", "direction",
            "style", "linkStyle", "classDef", "class", "click", "call", "href", "default");

    private ArchitectureExporter() {
    }

    /**
     * @param model the architecture model
     * @return a C4-PlantUML component diagram of the model
     */
    public static String toPlantUml(ArchitectureModel model) {
        return toPlantUml(model, Level.COMPONENT);
    }

    /**
     * @param model the architecture model
     * @return a Mermaid flowchart of the components of the model
     */
    public static String toMermaid(ArchitectureModel model) {
        return toMermaid(model, Level.COMPONENT);
    }

    /**
     * @param model the architecture model
     * @param level the C4 level of the diagram
     * @return a C4-PlantUML diagram of the model at that level
     */
    public static String toPlantUml(ArchitectureModel model, Level level) {
        Map<String, String> ids = ids(model);
        StringBuilder out = new StringBuilder();
        out.append("@startuml\n");
        out.append(switch (level) {
            case CONTEXT -> "!include <C4/C4_Context>\n\n";
            case CONTAINER -> "!include <C4/C4_Container>\n\n";
            case COMPONENT -> "!include <C4/C4_Component>\n\n";
        });
        out.append("title ").append(escape(model.application())).append(" - ").append(switch (level) {
            case CONTEXT -> "system context";
            case CONTAINER -> "containers";
            case COMPONENT -> "components";
        }).append("\n\n");
        if (hasUsers(model)) {
            out.append("Person(").append(USER_ID).append(", \"User\", \"Calls the application over the network\")\n\n");
        }

        // Elements
        if (level == Level.CONTEXT) {
            out.append("System(").append(ids.get(ArchitectureScanner.APPLICATION_ID)).append(", \"")
                    .append(escape(model.application())).append("\", \"").append(escape(summary(model))).append("\")\n");
        } else {
            out.append("System_Boundary(").append(SYSTEM_ID).append(", \"").append(escape(model.application()))
                    .append("\") {\n");
            if (level == Level.CONTAINER) {
                out.append("    Container(").append(ids.get(ArchitectureScanner.APPLICATION_ID)).append(", \"")
                        .append(escape(model.application())).append("\", \"").append(escape(quarkus(model)))
                        .append("\", \"").append(escape(summary(model))).append("\")\n");
            } else {
                out.append("    Container_Boundary(").append(ids.get(ArchitectureScanner.APPLICATION_ID)).append(", \"")
                        .append(escape(model.application())).append("\") {\n");
                for (Node node : model.nodes()) {
                    if (!node.isExternal()) {
                        String macro = "entity".equals(node.kind()) || "repository".equals(node.kind()) ? "ComponentDb"
                                : "Component";
                        out.append("        ").append(macro).append('(').append(ids.get(node.id())).append(", \"")
                                .append(escape(node.name())).append("\", \"").append(escape(node.technology()))
                                .append("\", \"").append(escape(node.kind())).append("\")\n");
                    }
                }
                out.append("    }\n");
            }
            for (Node node : model.nodes()) {
                if (node.isContainer()) {
                    String macro = "message-broker".equals(node.kind()) ? "ContainerQueue" : "ContainerDb";
                    out.append("    ").append(macro).append('(').append(ids.get(node.id())).append(", \"")
                            .append(escape(node.name())).append("\", \"").append(escape(node.technology()))
                            .append("\")\n");
                }
            }
            out.append("}\n");
        }
        for (Node node : model.nodes()) {
            if (node.isExternal() && !node.isContainer()) {
                out.append("System_Ext(").append(ids.get(node.id())).append(", \"").append(escape(node.name()))
                        .append("\", \"").append(escape(node.technology())).append("\")\n");
            }
        }
        out.append('\n');

        // Relations
        for (Relation relation : relations(model, level)) {
            out.append("Rel(").append(ids.getOrDefault(relation.source(), relation.source())).append(", ")
                    .append(ids.getOrDefault(relation.target(), relation.target())).append(", \"")
                    .append(escape(relation.label())).append("\")\n");
        }
        out.append("@enduml\n");
        return out.toString();
    }

    /**
     * @param model the architecture model
     * @param level the C4 level of the diagram
     * @return a Mermaid flowchart of the model at that level
     */
    public static String toMermaid(ArchitectureModel model, Level level) {
        Map<String, String> ids = ids(model);
        StringBuilder out = new StringBuilder();
        out.append("flowchart LR\n");
        if (hasUsers(model)) {
            out.append("    ").append(USER_ID).append("([\"User\"])\n");
        }
        String app = ids.get(ArchitectureScanner.APPLICATION_ID);
        if (level == Level.CONTEXT) {
            out.append("    ").append(app).append("[\"").append(mermaidText(model.application())).append("<br/><small>")
                    .append(mermaidText(summary(model))).append("</small>\"]\n");
        } else {
            out.append("    subgraph ").append(SYSTEM_ID).append("[\"").append(mermaidText(model.application()))
                    .append("\"]\n");
            if (level == Level.CONTAINER) {
                out.append("        ").append(app).append("[\"").append(mermaidText(model.application()))
                        .append("<br/><small>").append(mermaidText(quarkus(model))).append("</small>\"]\n");
            } else {
                out.append("        subgraph ").append(app).append("[\"").append(mermaidText(model.application()))
                        .append("\"]\n");
                for (String layer : ArchitectureModel.LAYERS) {
                    for (Node node : model.nodes()) {
                        if (layer.equals(node.layer()) && !node.isExternal()) {
                            out.append("            ").append(ids.get(node.id())).append(shape(node)).append('\n');
                        }
                    }
                }
                out.append("        end\n");
            }
            for (Node node : model.nodes()) {
                if (node.isContainer()) {
                    out.append("        ").append(ids.get(node.id())).append(shape(node)).append('\n');
                }
            }
            out.append("    end\n");
        }
        for (Node node : model.nodes()) {
            if (node.isExternal() && !node.isContainer()) {
                out.append("    ").append(ids.get(node.id())).append(shape(node)).append('\n');
            }
        }
        for (Relation relation : relations(model, level)) {
            out.append("    ").append(ids.getOrDefault(relation.source(), relation.source())).append(" -->|\"")
                    .append(mermaidText(relation.label())).append("\"| ")
                    .append(ids.getOrDefault(relation.target(), relation.target())).append('\n');
        }
        return out.toString();
    }

    /**
     * A relation drawn at one level, possibly the union of several relations of the model.
     */
    record Relation(String source, String target, String label) {
    }

    /**
     * Returns the relations to draw at a level. At the context and container levels, the components are folded into
     * the application, so their relations to the same element become one relation with all their labels.
     */
    static List<Relation> relations(ArchitectureModel model, Level level) {
        List<Relation> relations = new ArrayList<>();
        if (hasUsers(model)) {
            String target = ArchitectureScanner.APPLICATION_ID;
            if (level == Level.COMPONENT) {
                for (Node node : model.nodes()) {
                    if (ArchitectureModel.NETWORK_ENTRY_POINTS.contains(node.kind())) {
                        relations.add(new Relation(USER_ID, node.id(), "calls"));
                    }
                }
            } else {
                relations.add(new Relation(USER_ID, target, "calls"));
            }
        }
        if (level == Level.COMPONENT) {
            for (Edge edge : model.edges()) {
                // The application is a boundary at this level, which a relation cannot start from
                if (!ArchitectureScanner.APPLICATION_ID.equals(edge.source())) {
                    relations.add(new Relation(edge.source(), edge.target(), label(edge)));
                }
            }
            return relations;
        }

        Map<String, Node> nodes = new LinkedHashMap<>();
        for (Node node : model.nodes()) {
            nodes.put(node.id(), node);
        }
        Map<String, Set<String>> folded = new LinkedHashMap<>();
        for (Edge edge : model.edges()) {
            String source = fold(edge.source(), nodes, level);
            String target = fold(edge.target(), nodes, level);
            if (source != null && target != null && !source.equals(target)) {
                folded.computeIfAbsent(source + "\n" + target, k -> new LinkedHashSet<>()).add(label(edge));
            }
        }
        for (Map.Entry<String, Set<String>> entry : folded.entrySet()) {
            String[] ends = entry.getKey().split("\n");
            relations.add(new Relation(ends[0], ends[1], String.join(", ", entry.getValue())));
        }
        return relations;
    }

    /**
     * Returns the element that stands for a node at a level, or {@code null} when the level does not show it.
     */
    private static String fold(String id, Map<String, Node> nodes, Level level) {
        Node node = nodes.get(id);
        if (node == null) {
            return ArchitectureScanner.APPLICATION_ID.equals(id) ? id : null;
        }
        if (!node.isExternal()) {
            return ArchitectureScanner.APPLICATION_ID;
        }
        if (level == Level.CONTEXT && node.isContainer()) {
            return ArchitectureScanner.APPLICATION_ID;
        }
        return id;
    }

    static boolean hasUsers(ArchitectureModel model) {
        return model.nodes().stream().anyMatch(n -> ArchitectureModel.NETWORK_ENTRY_POINTS.contains(n.kind()));
    }

    private static String summary(ArchitectureModel model) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Node node : model.nodes()) {
            if (!node.isExternal()) {
                counts.merge(node.kind(), 1, Integer::sum);
            }
        }
        List<String> parts = new ArrayList<>();
        counts.forEach((kind, count) -> parts.add(count + " " + kind));
        return String.join(", ", parts);
    }

    private static String quarkus(ArchitectureModel model) {
        return model.quarkusVersion() == null ? "Quarkus" : "Quarkus " + model.quarkusVersion();
    }

    private static String shape(Node node) {
        String text = "\"" + mermaidText(node.name()) + "<br/><small>" + mermaidText(node.kind()) + "</small>\"";
        return switch (node.kind()) {
            case "database", "cache", "entity" -> "[(" + text + ")]";
            case "message-broker" -> "[[" + text + "]]";
            case "rest-endpoint", "websocket", "route", "grpc-service", "graphql", "function" -> "([" + text + "])";
            default -> node.isExternal() ? "{{" + text + "}}" : "[" + text + "]";
        };
    }

    static String label(Edge edge) {
        return edge.label() == null || edge.label().isBlank() ? edge.kind() : edge.kind() + " " + edge.label();
    }

    /**
     * Maps the node ids to identifiers that both diagram languages accept.
     */
    private static Map<String, String> ids(ArchitectureModel model) {
        Map<String, String> ids = new LinkedHashMap<>();
        ids.put(ArchitectureScanner.APPLICATION_ID, "app");
        Set<String> taken = new HashSet<>(ids.values());
        taken.add(USER_ID);
        taken.add(SYSTEM_ID);
        taken.addAll(MERMAID_KEYWORDS);
        int counter = 0;
        for (Node node : model.nodes()) {
            String base = node.id().replaceAll("[^A-Za-z0-9]", "_");
            String id = base;
            while (!taken.add(id)) {
                id = base + "_" + (++counter);
            }
            ids.put(node.id(), id);
        }
        return ids;
    }

    private static String escape(String value) {
        return value == null ? "" : value.replace("\"", "'");
    }

    /**
     * Writes a value with Mermaid entity codes for the characters that Mermaid reads as markup: {@code #} starts an
     * entity code, {@code "} ends the label, and {@code <} and {@code >} make an HTML tag.
     */
    private static String mermaidText(String value) {
        return value == null ? ""
                : value.replace("#", "#35;").replace("\"", "#quot;").replace("<", "#lt;").replace(">", "#gt;");
    }
}

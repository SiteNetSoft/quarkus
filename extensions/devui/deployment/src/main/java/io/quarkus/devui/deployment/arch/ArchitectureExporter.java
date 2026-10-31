package io.quarkus.devui.deployment.arch;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import io.quarkus.devui.deployment.arch.ArchitectureModel.Edge;
import io.quarkus.devui.deployment.arch.ArchitectureModel.Node;

/**
 * Writes an {@link ArchitectureModel} as text diagrams: a C4-PlantUML component diagram and a Mermaid flowchart.
 */
public final class ArchitectureExporter {

    private ArchitectureExporter() {
    }

    /**
     * @param model the architecture model
     * @return a C4-PlantUML component diagram of the model
     */
    public static String toPlantUml(ArchitectureModel model) {
        Map<String, String> ids = ids(model);
        StringBuilder out = new StringBuilder();
        out.append("@startuml\n");
        out.append("!include <C4/C4_Component>\n\n");
        out.append("title ").append(escape(model.application())).append(" - components\n\n");
        for (Node node : model.nodes()) {
            if (node.isExternal()) {
                String macro = switch (node.kind()) {
                    case "database", "cache" -> "SystemDb_Ext";
                    case "message-broker" -> "SystemQueue_Ext";
                    default -> "System_Ext";
                };
                out.append(macro).append('(').append(ids.get(node.id())).append(", \"").append(escape(node.name()))
                        .append("\", \"").append(escape(node.technology())).append("\")\n");
            }
        }
        out.append("\nContainer_Boundary(").append(ids.get(ArchitectureScanner.APPLICATION_ID)).append(", \"")
                .append(escape(model.application())).append("\") {\n");
        for (Node node : model.nodes()) {
            if (!node.isExternal()) {
                String macro = "entity".equals(node.kind()) || "repository".equals(node.kind()) ? "ComponentDb"
                        : "Component";
                out.append("    ").append(macro).append('(').append(ids.get(node.id())).append(", \"")
                        .append(escape(node.name())).append("\", \"").append(escape(node.technology())).append("\", \"")
                        .append(escape(node.kind())).append("\")\n");
            }
        }
        out.append("}\n\n");
        for (Edge edge : model.edges()) {
            out.append("Rel(").append(ids.get(edge.source())).append(", ").append(ids.get(edge.target())).append(", \"")
                    .append(escape(label(edge))).append("\")\n");
        }
        out.append("@enduml\n");
        return out.toString();
    }

    /**
     * @param model the architecture model
     * @return a Mermaid flowchart of the model
     */
    public static String toMermaid(ArchitectureModel model) {
        Map<String, String> ids = ids(model);
        StringBuilder out = new StringBuilder();
        out.append("flowchart LR\n");
        out.append("    subgraph ").append(ids.get(ArchitectureScanner.APPLICATION_ID)).append("[\"")
                .append(mermaidText(model.application())).append("\"]\n");
        for (String layer : ArchitectureModel.LAYERS) {
            if (Node.LAYER_EXTERNAL.equals(layer)) {
                continue;
            }
            for (Node node : model.nodes()) {
                if (layer.equals(node.layer())) {
                    out.append("        ").append(ids.get(node.id())).append(shape(node)).append('\n');
                }
            }
        }
        out.append("    end\n");
        for (Node node : model.nodes()) {
            if (node.isExternal()) {
                out.append("    ").append(ids.get(node.id())).append(shape(node)).append('\n');
            }
        }
        for (Edge edge : model.edges()) {
            out.append("    ").append(ids.get(edge.source())).append(" -->|\"").append(mermaidText(label(edge)))
                    .append("\"| ").append(ids.get(edge.target())).append('\n');
        }
        return out.toString();
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

    private static String mermaidText(String value) {
        return value == null ? "" : value.replace("\"", "#quot;");
    }
}

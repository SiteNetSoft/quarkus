package io.quarkus.devui.deployment.arch;

import java.util.List;
import java.util.Locale;

/**
 * The architecture of the application, as Quarkus sees it at build time: the components of the application, the
 * external systems it talks to, and the relations between them.
 *
 * @param application the name of the application
 * @param version the version of the application
 * @param quarkusVersion the version of Quarkus
 * @param nodes the components and external systems
 * @param edges the relations between the nodes
 */
public record ArchitectureModel(String application, String version, String quarkusVersion, List<Node> nodes,
        List<Edge> edges) {

    /**
     * The layers of the component view, from the entry points of the application to the external systems.
     */
    public static final List<String> LAYERS = List.of(Node.LAYER_ENTRY, Node.LAYER_LOGIC, Node.LAYER_DATA,
            Node.LAYER_INTEGRATION, Node.LAYER_EXTERNAL);

    /**
     * The node kinds that are entry points for users and clients over the network.
     */
    public static final List<String> NETWORK_ENTRY_POINTS = List.of("rest-endpoint", "route", "websocket", "graphql",
            "grpc-service", "function");

    public ArchitectureModel {
        nodes = List.copyOf(nodes);
        edges = List.copyOf(edges);
    }

    /**
     * The C4 levels of the architecture.
     */
    public enum Level {
        /**
         * The application as one software system, with its users and the external systems it uses.
         */
        CONTEXT,
        /**
         * The Quarkus application and the data stores and brokers it uses.
         */
        CONTAINER,
        /**
         * The components of the Quarkus application.
         */
        COMPONENT;

        /**
         * @return the name of the level in paths, for example {@code context}
         */
        public String path() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    /**
     * A component of the application or an external system.
     *
     * @param id the unique id of the node
     * @param name the short name to display
     * @param kind the kind of node, for example {@code rest-endpoint}, {@code bean} or {@code database}
     * @param layer the layer of the node, one of {@link ArchitectureModel#LAYERS}
     * @param technology the technology, for example {@code Jakarta REST} or {@code PostgreSQL}
     * @param className the class of a component, {@code null} for an external system
     * @param details the details to display, for example the endpoints of a REST resource
     * @param devService whether a Dev Service provides this external system
     */
    public record Node(String id, String name, String kind, String layer, String technology, String className,
            List<String> details, boolean devService) {

        public static final String LAYER_ENTRY = "entry";
        public static final String LAYER_LOGIC = "logic";
        public static final String LAYER_DATA = "data";
        public static final String LAYER_INTEGRATION = "integration";
        public static final String LAYER_EXTERNAL = "external";

        public Node {
            details = List.copyOf(details);
        }

        /**
         * @return whether this node is outside the application: a container it uses or an external system
         */
        public boolean isExternal() {
            return LAYER_EXTERNAL.equals(layer);
        }

        /**
         * A database, cache or message broker is a C4 container next to the application. The other external nodes
         * are external software systems.
         *
         * @return whether this node is a data store or a message broker
         */
        public boolean isContainer() {
            return isExternal() && ("database".equals(kind) || "cache".equals(kind) || "message-broker".equals(kind));
        }
    }

    /**
     * A relation between two nodes.
     *
     * @param source the id of the source node
     * @param target the id of the target node
     * @param kind the kind of relation, for example {@code injects}, {@code calls} or {@code publishes}
     * @param label the label to display, for example a channel name, or {@code null}
     */
    public record Edge(String source, String target, String kind, String label) {
    }
}

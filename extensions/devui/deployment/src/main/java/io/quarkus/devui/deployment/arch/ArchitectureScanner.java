package io.quarkus.devui.deployment.arch;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.jboss.jandex.AnnotationInstance;
import org.jboss.jandex.AnnotationValue;
import org.jboss.jandex.ClassInfo;
import org.jboss.jandex.DotName;
import org.jboss.jandex.FieldInfo;
import org.jboss.jandex.IndexView;
import org.jboss.jandex.MethodInfo;
import org.jboss.jandex.MethodParameterInfo;
import org.jboss.jandex.ParameterizedType;
import org.jboss.jandex.Type;

import io.quarkus.devui.deployment.arch.ArchitectureModel.Edge;
import io.quarkus.devui.deployment.arch.ArchitectureModel.Node;

/**
 * Builds the {@link ArchitectureModel} of an application from its index, its CDI injection points, its configuration
 * and its Dev Services.
 * <p>
 * The scanner recognizes the annotations and types of the Quarkus extensions by name, so it does not need the
 * extensions on its classpath.
 */
public final class ArchitectureScanner {

    /**
     * The id of the application itself, used as the source of the relations that belong to the whole application,
     * such as the authentication against an identity provider.
     */
    public static final String APPLICATION_ID = "app";

    /**
     * An injection point of an application bean.
     *
     * @param beanClass the class of the bean that declares the injection point
     * @param requiredType the required type, without its type arguments
     * @param resolvedClass the class of the bean that satisfies the injection point, or {@code null}
     * @param qualifiers the qualifiers of the injection point, by annotation name, with their {@code value}
     */
    public record Injection(String beanClass, String requiredType, String resolvedClass, Map<String, String> qualifiers) {

        public Injection {
            qualifiers = Map.copyOf(qualifiers);
        }
    }

    /**
     * A running Dev Service.
     *
     * @param name the name of the Dev Service
     * @param description the description of the Dev Service, for example its container image
     */
    public record DevService(String name, String description) {
    }

    // Entry points
    static final DotName PATH = DotName.createSimple("jakarta.ws.rs.Path");
    static final List<DotName> HTTP_METHODS = List.of(DotName.createSimple("jakarta.ws.rs.GET"),
            DotName.createSimple("jakarta.ws.rs.POST"), DotName.createSimple("jakarta.ws.rs.PUT"),
            DotName.createSimple("jakarta.ws.rs.DELETE"), DotName.createSimple("jakarta.ws.rs.PATCH"),
            DotName.createSimple("jakarta.ws.rs.HEAD"), DotName.createSimple("jakarta.ws.rs.OPTIONS"));
    static final DotName ROUTE = DotName.createSimple("io.quarkus.vertx.web.Route");
    static final DotName ROUTE_BASE = DotName.createSimple("io.quarkus.vertx.web.RouteBase");
    static final DotName WEBSOCKET = DotName.createSimple("io.quarkus.websockets.next.WebSocket");
    static final DotName WEBSOCKET_CLIENT = DotName.createSimple("io.quarkus.websockets.next.WebSocketClient");
    static final DotName SERVER_ENDPOINT = DotName.createSimple("jakarta.websocket.server.ServerEndpoint");
    static final DotName GRPC_SERVICE = DotName.createSimple("io.quarkus.grpc.GrpcService");
    static final DotName GRPC_CLIENT = DotName.createSimple("io.quarkus.grpc.GrpcClient");
    static final DotName GRAPHQL_API = DotName.createSimple("org.eclipse.microprofile.graphql.GraphQLApi");
    static final DotName FUNQ = DotName.createSimple("io.quarkus.funqy.Funq");
    static final DotName SCHEDULED = DotName.createSimple("io.quarkus.scheduler.Scheduled");
    static final DotName SCHEDULES = DotName.createSimple("io.quarkus.scheduler.Scheduled$Schedules");

    // Messaging
    static final DotName INCOMING = DotName.createSimple("org.eclipse.microprofile.reactive.messaging.Incoming");
    static final DotName INCOMINGS = DotName.createSimple("io.smallrye.reactive.messaging.annotations.Incomings");
    static final DotName OUTGOING = DotName.createSimple("org.eclipse.microprofile.reactive.messaging.Outgoing");
    static final DotName OUTGOINGS = DotName.createSimple("io.smallrye.reactive.messaging.annotations.Outgoings");
    static final Set<String> CHANNEL_QUALIFIERS = Set.of("org.eclipse.microprofile.reactive.messaging.Channel",
            "io.smallrye.reactive.messaging.annotations.Channel");

    // Integrations
    static final DotName REGISTER_REST_CLIENT = DotName
            .createSimple("org.eclipse.microprofile.rest.client.inject.RegisterRestClient");
    static final String REST_CLIENT_QUALIFIER = "org.eclipse.microprofile.rest.client.inject.RestClient";

    // Data
    static final DotName ENTITY = DotName.createSimple("jakarta.persistence.Entity");
    static final DotName JAKARTA_DATA_REPOSITORY = DotName.createSimple("jakarta.data.repository.Repository");
    static final Set<DotName> RELATIONS = Set.of(DotName.createSimple("jakarta.persistence.OneToOne"),
            DotName.createSimple("jakarta.persistence.OneToMany"), DotName.createSimple("jakarta.persistence.ManyToOne"),
            DotName.createSimple("jakarta.persistence.ManyToMany"));
    static final Set<String> REPOSITORY_TYPES = Set.of(
            "io.quarkus.hibernate.orm.panache.PanacheRepository",
            "io.quarkus.hibernate.orm.panache.PanacheRepositoryBase",
            "io.quarkus.hibernate.reactive.panache.PanacheRepository",
            "io.quarkus.hibernate.reactive.panache.PanacheRepositoryBase",
            "io.quarkus.hibernate.orm.panache.kotlin.PanacheRepository",
            "io.quarkus.hibernate.orm.panache.kotlin.PanacheRepositoryBase",
            "org.springframework.data.repository.Repository",
            "org.springframework.data.repository.CrudRepository",
            "org.springframework.data.jpa.repository.JpaRepository",
            "jakarta.data.repository.CrudRepository",
            "jakarta.data.repository.BasicRepository",
            "jakarta.data.repository.DataRepository");
    static final Set<String> DATA_ACCESS_TYPES = Set.of(
            "jakarta.persistence.EntityManager",
            "jakarta.persistence.EntityManagerFactory",
            "org.hibernate.Session",
            "org.hibernate.StatelessSession",
            "org.hibernate.SessionFactory",
            "org.hibernate.reactive.mutiny.Mutiny$SessionFactory",
            "org.hibernate.reactive.mutiny.Mutiny$Session",
            "javax.sql.DataSource",
            "io.agroal.api.AgroalDataSource",
            "io.vertx.sqlclient.Pool",
            "io.vertx.mutiny.sqlclient.Pool",
            "io.vertx.mutiny.pgclient.PgPool",
            "io.vertx.mutiny.mysqlclient.MySQLPool");
    static final Set<String> DATA_SOURCE_QUALIFIERS = Set.of("io.quarkus.hibernate.orm.PersistenceUnit",
            "io.quarkus.agroal.DataSource", "io.quarkus.reactive.datasource.ReactiveDataSource");
    static final Set<String> REDIS_TYPES = Set.of(
            "io.quarkus.redis.datasource.RedisDataSource",
            "io.quarkus.redis.datasource.ReactiveRedisDataSource",
            "io.vertx.redis.client.Redis",
            "io.vertx.mutiny.redis.client.Redis",
            "io.vertx.mutiny.redis.client.RedisAPI");

    private static final Pattern DB_KIND = Pattern
            .compile("^quarkus\\.datasource\\.(?:\"([^\"]+)\"\\.|([^.\"]+)\\.)?db-kind$");
    private static final Pattern CHANNEL_CONNECTOR = Pattern
            .compile("^mp\\.messaging\\.(incoming|outgoing)\\.(\"[^\"]+\"|[^.]+)\\.connector$");
    private static final String DEFAULT_DATASOURCE = "<default>";

    private static final Map<String, String> DB_NAMES = Map.of(
            "postgresql", "PostgreSQL",
            "mysql", "MySQL",
            "mariadb", "MariaDB",
            "mssql", "SQL Server",
            "oracle", "Oracle",
            "db2", "Db2",
            "h2", "H2",
            "derby", "Derby");

    private static final Map<String, String> BROKERS = Map.of(
            "smallrye-kafka", "Kafka",
            "smallrye-amqp", "AMQP",
            "smallrye-rabbitmq", "RabbitMQ",
            "smallrye-pulsar", "Pulsar",
            "smallrye-mqtt", "MQTT",
            "smallrye-jms", "JMS");

    private final IndexView index;
    private final Predicate<DotName> applicationClass;
    private final Set<String> beanClasses;
    private final List<Injection> injections;
    private final Function<String, Optional<String>> config;
    private final Iterable<String> propertyNames;
    private final List<DevService> devServices;

    private final Map<String, NodeBuilder> nodes = new LinkedHashMap<>();
    private final Set<Edge> edges = new LinkedHashSet<>();
    private final Map<String, Set<String>> producedChannels = new LinkedHashMap<>();
    private final Map<String, Set<String>> consumedChannels = new LinkedHashMap<>();

    /**
     * @param index the index of the application and its dependencies
     * @param applicationClass whether a class belongs to the application
     * @param beanClasses the classes of the application beans
     * @param injections the injection points of the application beans
     * @param config the configuration, by property name
     * @param propertyNames the names of the configuration properties
     * @param devServices the running Dev Services
     */
    public ArchitectureScanner(IndexView index, Predicate<DotName> applicationClass, Collection<String> beanClasses,
            List<Injection> injections, Function<String, Optional<String>> config, Iterable<String> propertyNames,
            List<DevService> devServices) {
        this.index = index;
        this.applicationClass = applicationClass;
        this.beanClasses = new HashSet<>(beanClasses);
        this.injections = injections;
        this.config = config;
        this.propertyNames = propertyNames;
        this.devServices = devServices;
    }

    /**
     * Builds the model.
     *
     * @param application the name of the application
     * @param version the version of the application
     * @return the architecture model
     */
    public ArchitectureModel scan(String application, String version) {
        addComponents();
        addInjections();
        addEntityRelations();
        addDatasources();
        addMessaging();
        addRestClients();
        addIdentityProvider();
        addDevServices();

        List<Node> result = new ArrayList<>();
        for (NodeBuilder node : nodes.values()) {
            result.add(node.build());
        }
        List<Edge> resultEdges = new ArrayList<>();
        for (Edge edge : edges) {
            if (!edge.source().equals(edge.target())
                    && (nodes.containsKey(edge.source()) || APPLICATION_ID.equals(edge.source()))
                    && nodes.containsKey(edge.target())) {
                resultEdges.add(edge);
            }
        }
        return new ArchitectureModel(application, version, result, resultEdges);
    }

    // Components

    private void addComponents() {
        Set<DotName> candidates = new TreeSet<>();
        for (ClassInfo clazz : index.getKnownClasses()) {
            if (applicationClass.test(clazz.name()) && !clazz.isAnnotation() && !clazz.isEnum()
                    && clazz.nestingType() != ClassInfo.NestingType.ANONYMOUS
                    && clazz.nestingType() != ClassInfo.NestingType.LOCAL) {
                candidates.add(clazz.name());
            }
        }
        for (DotName name : candidates) {
            ClassInfo clazz = index.getClassByName(name);
            NodeBuilder node = classify(clazz);
            if (node != null) {
                nodes.put(node.id, node);
            }
        }
    }

    private NodeBuilder classify(ClassInfo clazz) {
        String className = clazz.name().toString();
        if (clazz.isInterface() && clazz.hasDeclaredAnnotation(REGISTER_REST_CLIENT)) {
            NodeBuilder node = component(clazz, "rest-client", Node.LAYER_INTEGRATION, "REST Client");
            node.details.addAll(restEndpoints(clazz));
            return node;
        }
        if (clazz.hasDeclaredAnnotation(ENTITY)) {
            NodeBuilder node = component(clazz, "entity", Node.LAYER_DATA, "Jakarta Persistence");
            AnnotationInstance entity = clazz.declaredAnnotation(ENTITY);
            if (entity.value("name") != null) {
                node.details.add("Entity name: " + entity.value("name").asString());
            }
            return node;
        }
        if (isRepository(clazz)) {
            return component(clazz, "repository", Node.LAYER_DATA, "Repository");
        }
        if (clazz.isInterface()) {
            return null;
        }
        List<String> endpoints = restEndpoints(clazz);
        if (clazz.hasDeclaredAnnotation(PATH) || !endpoints.isEmpty()) {
            NodeBuilder node = component(clazz, "rest-endpoint", Node.LAYER_ENTRY, "Jakarta REST");
            node.details.addAll(endpoints);
            return node;
        }
        if (clazz.hasDeclaredAnnotation(WEBSOCKET) || clazz.hasDeclaredAnnotation(SERVER_ENDPOINT)) {
            AnnotationInstance ws = clazz.hasDeclaredAnnotation(WEBSOCKET) ? clazz.declaredAnnotation(WEBSOCKET)
                    : clazz.declaredAnnotation(SERVER_ENDPOINT);
            NodeBuilder node = component(clazz, "websocket", Node.LAYER_ENTRY, "WebSockets");
            String path = ws.value("path") != null ? ws.value("path").asString()
                    : ws.value() != null ? ws.value().asString() : null;
            if (path != null) {
                node.details.add("WS " + path);
            }
            return node;
        }
        if (clazz.hasDeclaredAnnotation(WEBSOCKET_CLIENT)) {
            NodeBuilder node = component(clazz, "websocket-client", Node.LAYER_INTEGRATION, "WebSockets Client");
            AnnotationInstance ws = clazz.declaredAnnotation(WEBSOCKET_CLIENT);
            if (ws.value("path") != null) {
                node.details.add("WS " + ws.value("path").asString());
            }
            return node;
        }
        if (clazz.hasDeclaredAnnotation(GRPC_SERVICE)) {
            return component(clazz, "grpc-service", Node.LAYER_ENTRY, "gRPC");
        }
        if (clazz.hasDeclaredAnnotation(GRAPHQL_API)) {
            return component(clazz, "graphql", Node.LAYER_ENTRY, "GraphQL");
        }

        List<String> routes = new ArrayList<>();
        List<String> functions = new ArrayList<>();
        List<String> schedules = new ArrayList<>();
        List<String> consumes = new ArrayList<>();
        List<String> produces = new ArrayList<>();
        for (MethodInfo method : clazz.methods()) {
            AnnotationInstance route = method.annotation(ROUTE);
            if (route != null) {
                routes.add(routeDescription(clazz, method, route));
            }
            if (method.hasDeclaredAnnotation(FUNQ)) {
                AnnotationInstance funq = method.declaredAnnotation(FUNQ);
                functions.add("Function " + (funq.value() != null ? funq.value().asString() : method.name()));
            }
            for (AnnotationInstance scheduled : repeatable(method, SCHEDULED, SCHEDULES)) {
                schedules.add(scheduleDescription(method, scheduled));
            }
            for (AnnotationInstance incoming : repeatable(method, INCOMING, INCOMINGS)) {
                String channel = incoming.value().asString();
                consumes.add("Consumes " + channel);
                consumedChannels.computeIfAbsent(channel, k -> new LinkedHashSet<>()).add(className);
            }
            for (AnnotationInstance outgoing : repeatable(method, OUTGOING, OUTGOINGS)) {
                String channel = outgoing.value().asString();
                produces.add("Produces " + channel);
                producedChannels.computeIfAbsent(channel, k -> new LinkedHashSet<>()).add(className);
            }
        }
        NodeBuilder node;
        if (!routes.isEmpty() || clazz.hasDeclaredAnnotation(ROUTE_BASE)) {
            node = component(clazz, "route", Node.LAYER_ENTRY, "Reactive Routes");
        } else if (!functions.isEmpty()) {
            node = component(clazz, "function", Node.LAYER_ENTRY, "Funqy");
        } else if (!consumes.isEmpty()) {
            node = component(clazz, "messaging", Node.LAYER_ENTRY, "Reactive Messaging");
        } else if (!schedules.isEmpty()) {
            node = component(clazz, "scheduled", Node.LAYER_ENTRY, "Scheduler");
        } else if (!produces.isEmpty()) {
            node = component(clazz, "messaging", Node.LAYER_LOGIC, "Reactive Messaging");
        } else if (beanClasses.contains(className)) {
            node = component(clazz, "bean", Node.LAYER_LOGIC, "CDI");
        } else {
            return null;
        }
        node.details.addAll(routes);
        node.details.addAll(functions);
        node.details.addAll(consumes);
        node.details.addAll(produces);
        node.details.addAll(schedules);
        return node;
    }

    private static NodeBuilder component(ClassInfo clazz, String kind, String layer, String technology) {
        String className = clazz.name().toString();
        return new NodeBuilder(className, simpleName(clazz), kind, layer, technology, className);
    }

    private static String simpleName(ClassInfo clazz) {
        if (clazz.nestingType() == ClassInfo.NestingType.INNER) {
            return clazz.enclosingClass().withoutPackagePrefix() + "." + clazz.simpleName();
        }
        return clazz.simpleName();
    }

    private boolean isRepository(ClassInfo clazz) {
        return clazz.hasDeclaredAnnotation(JAKARTA_DATA_REPOSITORY) || repositoryType(clazz, 0) != null;
    }

    private Type repositoryType(ClassInfo clazz, int depth) {
        if (clazz == null || depth > 5) {
            return null;
        }
        List<Type> supertypes = new ArrayList<>(clazz.interfaceTypes());
        if (clazz.superClassType() != null) {
            supertypes.add(clazz.superClassType());
        }
        for (Type supertype : supertypes) {
            if (REPOSITORY_TYPES.contains(supertype.name().toString())) {
                return supertype;
            }
        }
        for (Type supertype : supertypes) {
            Type found = repositoryType(index.getClassByName(supertype.name()), depth + 1);
            if (found != null) {
                return found;
            }
        }
        return null;
    }

    private List<String> restEndpoints(ClassInfo clazz) {
        List<String> endpoints = new ArrayList<>();
        AnnotationInstance classPath = clazz.declaredAnnotation(PATH);
        String base = classPath != null && classPath.value() != null ? classPath.value().asString() : "";
        for (MethodInfo method : clazz.methods()) {
            for (DotName httpMethod : HTTP_METHODS) {
                if (method.hasDeclaredAnnotation(httpMethod)) {
                    AnnotationInstance methodPath = method.declaredAnnotation(PATH);
                    String path = joinPaths(base, methodPath != null && methodPath.value() != null
                            ? methodPath.value().asString()
                            : "");
                    endpoints.add(httpMethod.withoutPackagePrefix() + " " + path);
                }
            }
        }
        return endpoints;
    }

    static String joinPaths(String first, String second) {
        String joined = "/" + trimSlashes(first) + "/" + trimSlashes(second);
        joined = joined.replaceAll("/+", "/");
        if (joined.length() > 1 && joined.endsWith("/")) {
            joined = joined.substring(0, joined.length() - 1);
        }
        return joined;
    }

    private static String trimSlashes(String path) {
        String result = path.trim();
        while (result.startsWith("/")) {
            result = result.substring(1);
        }
        while (result.endsWith("/")) {
            result = result.substring(0, result.length() - 1);
        }
        return result;
    }

    private static String routeDescription(ClassInfo clazz, MethodInfo method, AnnotationInstance route) {
        AnnotationInstance base = clazz.declaredAnnotation(ROUTE_BASE);
        String basePath = base != null && base.value("path") != null ? base.value("path").asString() : "";
        AnnotationValue path = route.value("path");
        AnnotationValue regex = route.value("regex");
        String routePath = path != null ? path.asString()
                : regex != null ? regex.asString() : method.name();
        AnnotationValue methods = route.value("methods");
        String verbs = methods != null ? String.join(",", methods.asEnumArray()) : "*";
        return verbs + " " + (regex != null && path == null ? routePath : joinPaths(basePath, routePath));
    }

    private static String scheduleDescription(MethodInfo method, AnnotationInstance scheduled) {
        AnnotationValue every = scheduled.value("every");
        AnnotationValue cron = scheduled.value("cron");
        if (every != null && !every.asString().isEmpty()) {
            return "Every " + every.asString() + " (" + method.name() + ")";
        }
        if (cron != null && !cron.asString().isEmpty()) {
            return "Cron " + cron.asString() + " (" + method.name() + ")";
        }
        return "Scheduled " + method.name();
    }

    /**
     * Returns the annotations of a repeatable annotation type on a method, whether repeated or not.
     * A channel annotation without a value is ignored, because it names no channel.
     */
    private static List<AnnotationInstance> repeatable(MethodInfo method, DotName single, DotName container) {
        boolean needsValue = !SCHEDULED.equals(single);
        List<AnnotationInstance> result = new ArrayList<>();
        AnnotationInstance annotation = method.declaredAnnotation(single);
        if (annotation != null && (!needsValue || annotation.value() != null)) {
            result.add(annotation);
        }
        AnnotationInstance containerAnnotation = method.declaredAnnotation(container);
        if (containerAnnotation != null && containerAnnotation.value() != null) {
            for (AnnotationInstance nested : containerAnnotation.value().asNestedArray()) {
                if (!needsValue || nested.value() != null) {
                    result.add(nested);
                }
            }
        }
        return result;
    }

    // Injections

    private void addInjections() {
        for (Injection injection : injections) {
            if (!nodes.containsKey(injection.beanClass())) {
                continue;
            }
            String source = injection.beanClass();
            String channel = qualifier(injection, CHANNEL_QUALIFIERS);
            if (channel != null) {
                producedChannels.computeIfAbsent(channel, k -> new LinkedHashSet<>()).add(source);
                nodes.get(source).details.add("Emits to " + channel);
                continue;
            }
            if (injection.qualifiers().containsKey(GRPC_CLIENT.toString())) {
                String client = injection.qualifiers().get(GRPC_CLIENT.toString());
                String target = grpcService(client == null || client.isEmpty() ? injection.requiredType() : client);
                edges.add(new Edge(source, target, "calls", "gRPC"));
                continue;
            }
            if (DATA_ACCESS_TYPES.contains(injection.requiredType())) {
                String datasource = qualifier(injection, DATA_SOURCE_QUALIFIERS);
                edges.add(new Edge(source, database(datasource == null ? DEFAULT_DATASOURCE : datasource), "queries",
                        simpleTypeName(injection.requiredType())));
                continue;
            }
            if (REDIS_TYPES.contains(injection.requiredType())) {
                edges.add(new Edge(source, redis(), "queries", "Redis"));
                continue;
            }
            if (injection.qualifiers().containsKey(REST_CLIENT_QUALIFIER) && !nodes.containsKey(injection.requiredType())) {
                ClassInfo client = index.getClassByName(injection.requiredType());
                if (client != null) {
                    NodeBuilder node = component(client, "rest-client", Node.LAYER_INTEGRATION, "REST Client");
                    node.details.addAll(restEndpoints(client));
                    nodes.put(node.id, node);
                }
            }
            String target = injection.resolvedClass() != null && nodes.containsKey(injection.resolvedClass())
                    ? injection.resolvedClass()
                    : injection.requiredType();
            if (nodes.containsKey(target)) {
                edges.add(new Edge(source, target, "injects", null));
            }
        }
    }

    private static String qualifier(Injection injection, Set<String> names) {
        for (String name : names) {
            if (injection.qualifiers().containsKey(name)) {
                String value = injection.qualifiers().get(name);
                return value == null ? "" : value;
            }
        }
        return null;
    }

    // Data

    private void addEntityRelations() {
        List<NodeBuilder> components = new ArrayList<>(nodes.values());
        for (NodeBuilder node : components) {
            ClassInfo clazz = index.getClassByName(node.className);
            if (clazz == null) {
                continue;
            }
            if ("repository".equals(node.kind)) {
                Type repository = repositoryType(clazz, 0);
                if (repository != null && repository.kind() == Type.Kind.PARAMETERIZED_TYPE) {
                    List<Type> arguments = repository.asParameterizedType().arguments();
                    if (!arguments.isEmpty() && isEntity(arguments.get(0).name().toString())) {
                        edges.add(new Edge(node.id, arguments.get(0).name().toString(), "manages", null));
                    }
                }
            }
            if ("entity".equals(node.kind)) {
                for (FieldInfo field : clazz.fields()) {
                    if (field.annotations().stream().anyMatch(a -> RELATIONS.contains(a.name()))) {
                        for (String entity : referencedEntities(field.type())) {
                            edges.add(new Edge(node.id, entity, "relates", field.name()));
                        }
                    }
                }
                continue;
            }
            Set<String> referenced = new LinkedHashSet<>();
            for (FieldInfo field : clazz.fields()) {
                referenced.addAll(referencedEntities(field.type()));
            }
            for (MethodInfo method : clazz.methods()) {
                referenced.addAll(referencedEntities(method.returnType()));
                for (MethodParameterInfo parameter : method.parameters()) {
                    referenced.addAll(referencedEntities(parameter.type()));
                }
            }
            for (String entity : referenced) {
                edges.add(new Edge(node.id, entity, "uses", null));
            }
        }
    }

    private boolean isEntity(String className) {
        NodeBuilder node = nodes.get(className);
        return node != null && "entity".equals(node.kind);
    }

    private Set<String> referencedEntities(Type type) {
        Set<String> result = new LinkedHashSet<>();
        collectEntities(type, result, 0);
        return result;
    }

    private void collectEntities(Type type, Set<String> result, int depth) {
        if (type == null || depth > 4) {
            return;
        }
        switch (type.kind()) {
            case CLASS -> {
                if (isEntity(type.name().toString())) {
                    result.add(type.name().toString());
                }
            }
            case PARAMETERIZED_TYPE -> {
                ParameterizedType parameterized = type.asParameterizedType();
                for (Type argument : parameterized.arguments()) {
                    collectEntities(argument, result, depth + 1);
                }
            }
            case ARRAY -> collectEntities(type.asArrayType().elementType(), result, depth + 1);
            case WILDCARD_TYPE -> {
                collectEntities(type.asWildcardType().extendsBound(), result, depth + 1);
                collectEntities(type.asWildcardType().superBound(), result, depth + 1);
            }
            default -> {
            }
        }
    }

    private void addDatasources() {
        for (String property : propertyNames) {
            Matcher matcher = DB_KIND.matcher(property);
            if (matcher.matches()) {
                String name = matcher.group(1) != null ? matcher.group(1)
                        : matcher.group(2) != null ? matcher.group(2) : DEFAULT_DATASOURCE;
                String id = database(name);
                String kind = config.apply(property).orElse("").toLowerCase(Locale.ROOT);
                NodeBuilder node = nodes.get(id);
                node.technology = DB_NAMES.getOrDefault(normalizeDbKind(kind), kind);
                node.name = DEFAULT_DATASOURCE.equals(name) ? node.technology : name + " (" + node.technology + ")";
            }
        }
        boolean hasEntities = nodes.values().stream().anyMatch(n -> "entity".equals(n.kind));
        if (hasEntities) {
            String target = nodes.containsKey(database(DEFAULT_DATASOURCE)) ? database(DEFAULT_DATASOURCE)
                    : nodes.keySet().stream().filter(id -> id.startsWith("db:")).findFirst()
                            .orElse(database(DEFAULT_DATASOURCE));
            for (NodeBuilder node : List.copyOf(nodes.values())) {
                if ("entity".equals(node.kind)) {
                    edges.add(new Edge(node.id, target, "stored-in", null));
                }
            }
        }
    }

    private String database(String name) {
        String id = "db:" + name;
        nodes.computeIfAbsent(id, k -> new NodeBuilder(k, DEFAULT_DATASOURCE.equals(name) ? "Database" : name,
                "database", Node.LAYER_EXTERNAL, "Database", null));
        return id;
    }

    private static String normalizeDbKind(String kind) {
        return switch (kind) {
            case "pg", "postgres", "pgsql" -> "postgresql";
            case "sqlserver", "microsoftsqlserver" -> "mssql";
            default -> kind;
        };
    }

    private String redis() {
        String id = "redis:default";
        nodes.computeIfAbsent(id, k -> new NodeBuilder(k, "Redis", "cache", Node.LAYER_EXTERNAL, "Redis", null));
        return id;
    }

    // Messaging

    private void addMessaging() {
        Map<String, String> connectors = new LinkedHashMap<>();
        for (String property : propertyNames) {
            Matcher matcher = CHANNEL_CONNECTOR.matcher(property);
            if (matcher.matches()) {
                String channel = unquote(matcher.group(2));
                config.apply(property).ifPresent(c -> connectors.put(matcher.group(1) + ":" + channel, c));
            }
        }
        String defaultConnector = defaultConnector(connectors.values());

        Set<String> channels = new TreeSet<>();
        channels.addAll(producedChannels.keySet());
        channels.addAll(consumedChannels.keySet());
        for (String channel : channels) {
            Set<String> producers = producedChannels.getOrDefault(channel, Set.of());
            Set<String> consumers = consumedChannels.getOrDefault(channel, Set.of());
            String outgoingConnector = connectors.get("outgoing:" + channel);
            String incomingConnector = connectors.get("incoming:" + channel);
            boolean internal = !producers.isEmpty() && !consumers.isEmpty() && outgoingConnector == null
                    && incomingConnector == null;
            for (String producer : producers) {
                if (internal) {
                    for (String consumer : consumers) {
                        edges.add(new Edge(producer, consumer, "publishes", channel));
                    }
                } else {
                    String connector = outgoingConnector != null ? outgoingConnector : defaultConnector;
                    String broker = broker(connector);
                    if (broker != null) {
                        edges.add(new Edge(producer, broker, "publishes", destination("outgoing", channel)));
                    }
                }
            }
            if (!internal) {
                for (String consumer : consumers) {
                    String connector = incomingConnector != null ? incomingConnector : defaultConnector;
                    String broker = broker(connector);
                    if (broker != null) {
                        edges.add(new Edge(broker, consumer, "delivers", destination("incoming", channel)));
                    }
                }
            }
        }
    }

    private String defaultConnector(Collection<String> configured) {
        Set<String> distinct = new LinkedHashSet<>(configured);
        distinct.remove("smallrye-in-memory");
        if (distinct.size() == 1) {
            return distinct.iterator().next();
        }
        if (distinct.isEmpty()) {
            Set<String> fromDevServices = new LinkedHashSet<>();
            for (DevService devService : devServices) {
                String name = devService.name().toLowerCase(Locale.ROOT);
                for (String connector : BROKERS.keySet()) {
                    if (name.contains(BROKERS.get(connector).toLowerCase(Locale.ROOT))) {
                        fromDevServices.add(connector);
                    }
                }
            }
            if (fromDevServices.size() == 1) {
                return fromDevServices.iterator().next();
            }
        }
        return null;
    }

    private String destination(String direction, String channel) {
        String prefix = "mp.messaging." + direction + "." + channel + ".";
        for (String attribute : List.of("topic", "address", "queue", "destination", "exchange.name")) {
            Optional<String> value = config.apply(prefix + attribute);
            if (value.isPresent()) {
                return value.get();
            }
        }
        return channel;
    }

    private String broker(String connector) {
        if (connector == null || "smallrye-in-memory".equals(connector)) {
            return null;
        }
        String name = BROKERS.getOrDefault(connector, connector);
        String id = "broker:" + name.toLowerCase(Locale.ROOT);
        nodes.computeIfAbsent(id, k -> new NodeBuilder(k, name, "message-broker", Node.LAYER_EXTERNAL, name, null));
        return id;
    }

    private static String unquote(String value) {
        return value.startsWith("\"") && value.endsWith("\"") ? value.substring(1, value.length() - 1) : value;
    }

    // Integrations

    private void addRestClients() {
        for (NodeBuilder node : List.copyOf(nodes.values())) {
            if (!"rest-client".equals(node.kind)) {
                continue;
            }
            ClassInfo clazz = index.getClassByName(node.className);
            AnnotationInstance register = clazz != null ? clazz.declaredAnnotation(REGISTER_REST_CLIENT) : null;
            String configKey = register != null && register.value("configKey") != null
                    ? register.value("configKey").asString()
                    : node.className;
            String url = restClientUrl(configKey, node.className)
                    .or(() -> Optional.ofNullable(register != null && register.value("baseUri") != null
                            ? register.value("baseUri").asString()
                            : null))
                    .orElse(null);
            String target = httpService(configKey, url);
            edges.add(new Edge(node.id, target, "calls", "HTTP"));
            node.details.add(0, "Config key: " + configKey);
        }
    }

    private Optional<String> restClientUrl(String configKey, String className) {
        List<String> keys = new ArrayList<>();
        keys.add("\"" + configKey + "\"");
        if (!configKey.contains(".")) {
            keys.add(configKey);
        }
        for (String key : keys) {
            for (String attribute : List.of("url", "uri")) {
                Optional<String> value = config.apply("quarkus.rest-client." + key + "." + attribute);
                if (value.isPresent()) {
                    return value;
                }
            }
        }
        for (String attribute : List.of("url", "uri")) {
            Optional<String> value = config.apply(configKey + "/mp-rest/" + attribute);
            if (value.isPresent()) {
                return value;
            }
            value = config.apply(className + "/mp-rest/" + attribute);
            if (value.isPresent()) {
                return value;
            }
        }
        return Optional.empty();
    }

    private String httpService(String configKey, String url) {
        String authority = null;
        if (url != null) {
            try {
                authority = URI.create(url.trim()).getAuthority();
            } catch (IllegalArgumentException e) {
                authority = null;
            }
        }
        String id = "http:" + (authority != null ? authority : configKey);
        NodeBuilder node = nodes.computeIfAbsent(id, k -> new NodeBuilder(k, null, "http-service",
                Node.LAYER_EXTERNAL, "HTTP", null));
        if (node.name == null) {
            node.name = authority != null ? authority : simpleTypeName(configKey);
            if (url == null) {
                node.details.add("No URL configured for " + configKey);
            } else {
                node.details.add(url);
                if (authority != null && (authority.startsWith("localhost") || authority.startsWith("127.0.0.1"))) {
                    node.details.add("Runs on this machine, maybe another Quarkus application in dev mode");
                }
            }
        }
        return id;
    }

    private String grpcService(String client) {
        String id = "grpc:" + client;
        NodeBuilder node = nodes.computeIfAbsent(id, k -> new NodeBuilder(k, client, "grpc-service",
                Node.LAYER_EXTERNAL, "gRPC", null));
        if (node.details.isEmpty()) {
            String prefix = "quarkus.grpc.clients." + client + ".";
            Optional<String> host = config.apply(prefix + "host");
            Optional<String> port = config.apply(prefix + "port");
            if (host.isPresent() || port.isPresent()) {
                node.details.add(host.orElse("localhost") + ":" + port.orElse("9000"));
            }
        }
        return id;
    }

    private void addIdentityProvider() {
        Optional<String> authServer = config.apply("quarkus.oidc.auth-server-url");
        boolean devService = devServices.stream().anyMatch(d -> {
            String name = d.name().toLowerCase(Locale.ROOT);
            return name.contains("keycloak") || name.contains("oidc");
        });
        if (authServer.isEmpty() && !devService) {
            return;
        }
        String id = "idp:oidc";
        NodeBuilder node = nodes.computeIfAbsent(id, k -> new NodeBuilder(k, "Identity provider", "identity-provider",
                Node.LAYER_EXTERNAL, "OpenID Connect", null));
        authServer.ifPresent(node.details::add);
        edges.add(new Edge(APPLICATION_ID, id, "authenticates", "OIDC"));
    }

    private void addDevServices() {
        for (DevService devService : devServices) {
            NodeBuilder match = matchingExternal(devService.name());
            if (match == null) {
                String id = "service:" + devService.name();
                match = nodes.computeIfAbsent(id, k -> new NodeBuilder(k, devService.name(), "service",
                        Node.LAYER_EXTERNAL, devService.name(), null));
            }
            match.devService = true;
            if (devService.description() != null && !devService.description().isBlank()) {
                match.details.add("Dev Service: " + devService.description());
            } else {
                match.details.add("Dev Service: " + devService.name());
            }
        }
    }

    private NodeBuilder matchingExternal(String devServiceName) {
        String name = devServiceName.toLowerCase(Locale.ROOT);
        for (NodeBuilder node : nodes.values()) {
            if (!Node.LAYER_EXTERNAL.equals(node.layer)) {
                continue;
            }
            String technology = node.technology == null ? "" : node.technology.toLowerCase(Locale.ROOT);
            String dbKind = DB_NAMES.entrySet().stream().filter(e -> e.getValue().equalsIgnoreCase(node.technology))
                    .map(Map.Entry::getKey).findFirst().orElse(null);
            boolean matches = switch (node.kind) {
                case "database" -> (dbKind != null && name.contains(dbKind))
                        || name.contains("datasource")
                        || ("postgresql".equals(dbKind) && name.contains("pg"))
                        || ("Database".equals(node.technology) && name.contains("db"));
                case "message-broker", "cache" -> !technology.isEmpty() && name.contains(technology);
                case "identity-provider" -> name.contains("keycloak") || name.contains("oidc");
                default -> false;
            };
            if (matches) {
                return node;
            }
        }
        return null;
    }

    private static String simpleTypeName(String name) {
        int dot = name.lastIndexOf('.');
        String simple = dot >= 0 ? name.substring(dot + 1) : name;
        return simple.replace('$', '.');
    }

    private static final class NodeBuilder {

        private final String id;
        private String name;
        private final String kind;
        private final String layer;
        private String technology;
        private final String className;
        private final List<String> details = new ArrayList<>();
        private boolean devService;

        private NodeBuilder(String id, String name, String kind, String layer, String technology, String className) {
            this.id = id;
            this.name = name;
            this.kind = kind;
            this.layer = layer;
            this.technology = technology;
            this.className = className;
        }

        private Node build() {
            return new Node(id, name, kind, layer, technology, className, new ArrayList<>(new LinkedHashSet<>(details)),
                    devService);
        }
    }
}

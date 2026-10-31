package io.quarkus.devui.deployment.menu;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.jboss.jandex.AnnotationInstance;
import org.jboss.jandex.AnnotationValue;

import io.quarkus.arc.deployment.CompletedApplicationClassPredicateBuildItem;
import io.quarkus.arc.deployment.ValidationPhaseBuildItem;
import io.quarkus.arc.processor.BeanInfo;
import io.quarkus.arc.processor.InjectionPointInfo;
import io.quarkus.builder.Version;
import io.quarkus.deployment.IsLocalDevelopment;
import io.quarkus.deployment.annotations.BuildProducer;
import io.quarkus.deployment.annotations.BuildStep;
import io.quarkus.deployment.builditem.ApplicationInfoBuildItem;
import io.quarkus.deployment.builditem.CombinedIndexBuildItem;
import io.quarkus.deployment.builditem.DevServicesResultBuildItem;
import io.quarkus.deployment.builditem.GeneratedResourceBuildItem;
import io.quarkus.devui.deployment.InternalPageBuildItem;
import io.quarkus.devui.deployment.arch.ArchitectureExporter;
import io.quarkus.devui.deployment.arch.ArchitectureModel;
import io.quarkus.devui.deployment.arch.ArchitectureModel.Level;
import io.quarkus.devui.deployment.arch.ArchitectureModelBuildItem;
import io.quarkus.devui.deployment.arch.ArchitectureScanner;
import io.quarkus.devui.runtime.ArchitectureHandler;
import io.quarkus.devui.spi.page.Page;
import io.quarkus.vertx.http.deployment.NonApplicationRootPathBuildItem;
import io.quarkus.vertx.http.deployment.RouteBuildItem;
import io.smallrye.config.Config;
import io.vertx.core.json.jackson.v3.DatabindCodec;

/**
 * Shows the architecture of the application in the Dev UI, and serves it as JSON, C4-PlantUML and Mermaid under
 * {@code /q/arch}. The diagrams exist for each C4 level, for example {@code /q/arch/plantuml/context}.
 */
public class ArchitectureProcessor {

    private static final String NAMESPACE = "devui-architecture";
    private static final String ROUTE = "arch";
    private static final String RESOURCE_PREFIX = "META-INF/quarkus-dev-ui/architecture";
    private static final String JSON = RESOURCE_PREFIX + ".json";
    private static final String PLANT_UML = "plantuml";
    private static final String MERMAID = "mermaid";
    private static final String TEXT = "text/plain; charset=utf-8";

    @BuildStep(onlyIf = IsLocalDevelopment.class)
    ArchitectureModelBuildItem buildModel(CombinedIndexBuildItem combinedIndex, ValidationPhaseBuildItem validationPhase,
            CompletedApplicationClassPredicateBuildItem applicationClasses,
            List<DevServicesResultBuildItem> devServicesResults, ApplicationInfoBuildItem applicationInfo) {

        // Beans and their injection points
        Set<String> beanClasses = new LinkedHashSet<>();
        List<ArchitectureScanner.Injection> injections = new ArrayList<>();
        for (BeanInfo bean : validationPhase.getContext().beans()) {
            BeanInfo owner = bean.isClassBean() ? bean : bean.getDeclaringBean();
            if (owner == null || !owner.isClassBean() || !applicationClasses.test(owner.getBeanClass())) {
                continue;
            }
            String ownerClass = owner.getBeanClass().toString();
            if (bean.isClassBean()) {
                beanClasses.add(ownerClass);
            }
            for (InjectionPointInfo injectionPoint : bean.getAllInjectionPoints()) {
                if (injectionPoint.isDelegate()) {
                    continue;
                }
                injections.add(new ArchitectureScanner.Injection(ownerClass,
                        injectionPoint.getRequiredType().name().toString(), resolvedClass(injectionPoint),
                        qualifiers(injectionPoint)));
            }
        }

        // Configuration and Dev Services
        Config config = Config.get();
        List<String> propertyNames = new ArrayList<>();
        config.getPropertyNames().forEach(propertyNames::add);
        List<ArchitectureScanner.DevService> devServices = new ArrayList<>();
        for (DevServicesResultBuildItem devService : devServicesResults) {
            devServices.add(new ArchitectureScanner.DevService(devService.getName(), devService.getDescription()));
        }

        ArchitectureScanner scanner = new ArchitectureScanner(combinedIndex.getIndex(), applicationClasses, beanClasses,
                injections, name -> configValue(config, name), propertyNames, devServices);
        return new ArchitectureModelBuildItem(scanner.scan(applicationInfo.getName(), applicationInfo.getVersion(),
                Version.getVersion()));
    }

    @BuildStep(onlyIf = IsLocalDevelopment.class)
    InternalPageBuildItem createPage(ArchitectureModelBuildItem architecture,
            NonApplicationRootPathBuildItem nonApplicationRootPath) {
        ArchitectureModel model = architecture.getModel();
        InternalPageBuildItem page = new InternalPageBuildItem("Architecture", 35);
        page.addPage(Page.webComponentPageBuilder()
                .namespace(NAMESPACE)
                .icon("font-awesome-solid:sitemap")
                .title("Architecture")
                .componentLink("qwc-architecture.js"));
        page.addBuildTimeData("architecture", model,
                "The architecture of this Quarkus application: its components (REST endpoints, beans, repositories, "
                        + "entities, REST clients, messaging), the external systems it uses (databases, message brokers, "
                        + "HTTP services, Dev Services) and the relations between them",
                true, null);
        Map<String, String> plantUml = new LinkedHashMap<>();
        Map<String, String> mermaid = new LinkedHashMap<>();
        for (Level level : Level.values()) {
            plantUml.put(level.path(), ArchitectureExporter.toPlantUml(model, level));
            mermaid.put(level.path(), ArchitectureExporter.toMermaid(model, level));
        }
        page.addBuildTimeData("architecturePlantUml", plantUml,
                "The architecture of this Quarkus application as C4-PlantUML diagrams, by C4 level: context, "
                        + "container and component");
        page.addBuildTimeData("architectureMermaid", mermaid,
                "The architecture of this Quarkus application as Mermaid flowcharts, by C4 level: context, "
                        + "container and component");
        page.addBuildTimeData("architecturePath", nonApplicationRootPath.resolvePath(ROUTE));
        return page;
    }

    @BuildStep(onlyIf = IsLocalDevelopment.class)
    void generateDocuments(ArchitectureModelBuildItem architecture, BuildProducer<GeneratedResourceBuildItem> resources) {
        ArchitectureModel model = architecture.getModel();
        String json = DatabindCodec.mapper().writerWithDefaultPrettyPrinter().writeValueAsString(model);
        resources.produce(new GeneratedResourceBuildItem(JSON, json.getBytes(StandardCharsets.UTF_8)));
        for (Level level : Level.values()) {
            resources.produce(new GeneratedResourceBuildItem(resource(PLANT_UML, level),
                    ArchitectureExporter.toPlantUml(model, level).getBytes(StandardCharsets.UTF_8)));
            resources.produce(new GeneratedResourceBuildItem(resource(MERMAID, level),
                    ArchitectureExporter.toMermaid(model, level).getBytes(StandardCharsets.UTF_8)));
        }
    }

    private static String resource(String format, Level level) {
        return RESOURCE_PREFIX + "-" + level.path() + "." + format;
    }

    @BuildStep(onlyIf = IsLocalDevelopment.class)
    void registerRoutes(ArchitectureModelBuildItem architecture, NonApplicationRootPathBuildItem nonApplicationRootPath,
            BuildProducer<RouteBuildItem> routes) {
        routes.produce(nonApplicationRootPath.routeBuilder()
                .route(ROUTE)
                .displayOnNotFoundPage("Architecture (JSON)")
                .handler(new ArchitectureHandler(JSON, "application/json"))
                .build());
        for (String format : List.of(PLANT_UML, MERMAID)) {
            String title = PLANT_UML.equals(format) ? "C4-PlantUML" : "Mermaid";
            routes.produce(nonApplicationRootPath.routeBuilder()
                    .nestedRoute(ROUTE, format)
                    .displayOnNotFoundPage("Architecture components (" + title + ")")
                    .handler(new ArchitectureHandler(resource(format, Level.COMPONENT), TEXT))
                    .build());
            for (Level level : Level.values()) {
                routes.produce(nonApplicationRootPath.routeBuilder()
                        .nestedRoute(ROUTE, format + "/" + level.path())
                        .handler(new ArchitectureHandler(resource(format, level), TEXT))
                        .build());
            }
        }
    }

    private static String resolvedClass(InjectionPointInfo injectionPoint) {
        BeanInfo resolved = injectionPoint.getResolvedBean();
        if (resolved == null) {
            return null;
        }
        if (resolved.isClassBean()) {
            return resolved.getBeanClass().toString();
        }
        BeanInfo declaring = resolved.getDeclaringBean();
        return declaring != null ? declaring.getBeanClass().toString() : null;
    }

    private static Map<String, String> qualifiers(InjectionPointInfo injectionPoint) {
        Map<String, String> qualifiers = new LinkedHashMap<>();
        for (AnnotationInstance qualifier : injectionPoint.getRequiredQualifiers()) {
            qualifiers.put(qualifier.name().toString(), valueOf(qualifier.value()));
        }
        return qualifiers;
    }

    private static String valueOf(AnnotationValue value) {
        if (value == null) {
            return "";
        }
        return switch (value.kind()) {
            case STRING -> value.asString();
            case ENUM -> value.asEnum();
            case CLASS -> value.asClass().name().toString();
            case ARRAY, NESTED, UNKNOWN -> "";
            default -> value.asString();
        };
    }

    private static Optional<String> configValue(Config config, String name) {
        try {
            return config.getOptionalValue(name, String.class);
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }
}

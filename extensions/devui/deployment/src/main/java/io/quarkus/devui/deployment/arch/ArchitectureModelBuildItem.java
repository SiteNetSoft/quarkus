package io.quarkus.devui.deployment.arch;

import io.quarkus.builder.item.SimpleBuildItem;

/**
 * Holds the {@link ArchitectureModel} of the application in dev mode.
 */
public final class ArchitectureModelBuildItem extends SimpleBuildItem {

    private final ArchitectureModel model;

    public ArchitectureModelBuildItem(ArchitectureModel model) {
        this.model = model;
    }

    public ArchitectureModel getModel() {
        return model;
    }
}

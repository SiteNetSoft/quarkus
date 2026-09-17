package io.quarkus.it.main;

import java.util.Map;

import io.quarkus.test.junit.callback.QuarkusTestAfterAllCallback;
import io.quarkus.test.junit.callback.QuarkusTestContext;

/**
 * Asserts the number of outer instances reported for each level of {@link OuterInstanceLeakReproducerTestCase}.
 * <p>
 * The expected numbers are the enclosing instances of the class whose {@code afterAll} is running, so the outer class
 * must report none. On a build with the leak, every level reports one too many and the outer class ends with one.
 */
public class OuterInstanceLeakCheckerAfterAllCallback implements QuarkusTestAfterAllCallback {

    private static final Map<String, Integer> EXPECTED = Map.of(
            OuterInstanceLeakReproducerTestCase.class.getName(), 0,
            OuterInstanceLeakReproducerTestCase.Middle.class.getName(), 1,
            OuterInstanceLeakReproducerTestCase.Middle.Inner.class.getName(), 2);

    @Override
    public void afterAll(QuarkusTestContext context) {
        String actualClass = context.getTestInstance().getClass().getName();
        Integer expected = EXPECTED.get(actualClass);
        if (expected == null) {
            return;
        }
        int actual = context.getOuterInstances().size();
        if (actual != expected) {
            throw new AssertionError("afterAll of " + actualClass + " reported " + actual
                    + " outer instances, expected " + expected);
        }
    }
}

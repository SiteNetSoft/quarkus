package io.quarkus.qute.deployment;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.io.ByteArrayInputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import io.quarkus.qute.ParserConfig;
import io.quarkus.qute.runtime.QuteContextData;
import io.quarkus.qute.runtime.QuteRecorder.TemplateInfo;

public class QuteContextDataTest {

    @Test
    public void testRoundTrip() {
        String large = "é".repeat(70_000);
        Map<String, TemplateInfo> templates = Map.of(
                "a.html", new TemplateInfo("a.html", "file:///app/templates/a.html", null),
                "b.txt", new TemplateInfo("b.txt", null, large));
        Map<String, List<String>> variants = Map.of("a", List.of("a.html", "a.txt"));
        Map<ParserConfig, Set<String>> configs = Map.of(new ParserConfig('='), Set.of("a.html", "a"));

        QuteContextData read = QuteContextData.read(new ByteArrayInputStream(
                new QuteContextData(templates, variants, configs).write()));

        assertEquals(2, read.templates().size());
        TemplateInfo a = read.templates().get("a.html");
        assertEquals("file:///app/templates/a.html", a.source);
        assertNull(a.content);
        TemplateInfo b = read.templates().get("b.txt");
        assertNull(b.source);
        assertEquals(large, b.content);
        assertEquals(variants, read.variants());
        assertEquals(configs, read.nonDefaultParserConfigs());
    }

    @Test
    public void testSameBytesForSameData() {
        Map<String, TemplateInfo> first = new LinkedHashMap<>();
        Map<String, TemplateInfo> second = new LinkedHashMap<>();
        for (int i = 0; i < 100; i++) {
            first.put("t" + i, new TemplateInfo("t" + i, null, null));
            second.put("t" + (99 - i), new TemplateInfo("t" + (99 - i), null, null));
        }
        assertArrayEquals(new QuteContextData(first, Map.of(), Map.of()).write(),
                new QuteContextData(second, Map.of(), Map.of()).write());
    }

    @Test
    public void testEmpty() {
        QuteContextData read = QuteContextData.read(new ByteArrayInputStream(
                new QuteContextData(Map.of(), Map.of(), Map.of()).write()));
        assertEquals(0, read.templates().size());
        assertEquals(0, read.variants().size());
        assertEquals(0, read.nonDefaultParserConfigs().size());
    }

}

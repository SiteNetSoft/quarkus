package io.quarkus.qute.runtime;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import io.quarkus.qute.ParserConfig;
import io.quarkus.qute.runtime.QuteRecorder.TemplateInfo;

/**
 * The template data that grows with the number of templates. The build writes it to a generated
 * resource instead of recording it, so that an application with tens of thousands of templates
 * does not exceed the constant pool of one generated class.
 */
public record QuteContextData(Map<String, TemplateInfo> templates, Map<String, List<String>> variants,
        Map<ParserConfig, Set<String>> nonDefaultParserConfigs) {

    /**
     * The name of the generated resource.
     */
    public static final String RESOURCE = "META-INF/quarkus-qute-context.bin";

    private static final int VERSION = 1;

    /**
     * @return the data in a stable order, so that the same templates give the same bytes
     */
    public byte[] write() {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (DataOutputStream out = new DataOutputStream(bytes)) {
            out.writeInt(VERSION);
            out.writeInt(templates.size());
            for (TemplateInfo template : new TreeMap<>(templates).values()) {
                writeString(out, template.path);
                writeString(out, template.source);
                writeString(out, template.content);
            }
            out.writeInt(variants.size());
            for (Map.Entry<String, List<String>> e : new TreeMap<>(variants).entrySet()) {
                writeString(out, e.getKey());
                writeStrings(out, e.getValue());
            }
            out.writeInt(nonDefaultParserConfigs.size());
            List<Map.Entry<ParserConfig, Set<String>>> configs = new ArrayList<>(nonDefaultParserConfigs.entrySet());
            configs.sort(Comparator.comparingInt(e -> command(e.getKey())));
            for (Map.Entry<ParserConfig, Set<String>> e : configs) {
                out.writeInt(command(e.getKey()));
                writeStrings(out, new TreeSet<>(e.getValue()));
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return bytes.toByteArray();
    }

    private static int command(ParserConfig config) {
        Character command = config.expressionCommand();
        return command == null ? -1 : command.charValue();
    }

    public static QuteContextData read(InputStream stream) {
        try (DataInputStream in = new DataInputStream(stream)) {
            int version = in.readInt();
            if (version != VERSION) {
                throw new IllegalStateException("Unsupported " + RESOURCE + " version: " + version);
            }
            int count = in.readInt();
            Map<String, TemplateInfo> templates = new HashMap<>(count * 2);
            for (int i = 0; i < count; i++) {
                String path = readString(in);
                templates.put(path, new TemplateInfo(path, readString(in), readString(in)));
            }
            count = in.readInt();
            Map<String, List<String>> variants = new HashMap<>(count * 2);
            for (int i = 0; i < count; i++) {
                variants.put(readString(in), readStrings(in, new ArrayList<>()));
            }
            count = in.readInt();
            Map<ParserConfig, Set<String>> configs = new HashMap<>(count * 2);
            for (int i = 0; i < count; i++) {
                int command = in.readInt();
                configs.put(new ParserConfig(command < 0 ? null : (char) command), readStrings(in, new HashSet<>()));
            }
            return new QuteContextData(templates, variants, configs);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    // Strings are written as UTF-8 bytes with an int length, -1 for null: writeUTF cannot
    // hold template content longer than 65,535 bytes.
    private static void writeString(DataOutputStream out, String value) throws IOException {
        if (value == null) {
            out.writeInt(-1);
            return;
        }
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        out.writeInt(bytes.length);
        out.write(bytes);
    }

    private static String readString(DataInputStream in) throws IOException {
        int length = in.readInt();
        if (length < 0) {
            return null;
        }
        return new String(in.readNBytes(length), StandardCharsets.UTF_8);
    }

    private static void writeStrings(DataOutputStream out, Collection<String> values) throws IOException {
        out.writeInt(values.size());
        for (String value : values) {
            writeString(out, value);
        }
    }

    private static <C extends Collection<String>> C readStrings(DataInputStream in, C into) throws IOException {
        int count = in.readInt();
        for (int i = 0; i < count; i++) {
            into.add(readString(in));
        }
        return into;
    }

}

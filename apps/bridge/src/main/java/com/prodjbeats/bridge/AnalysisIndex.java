package com.prodjbeats.bridge;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.List;
import java.util.Map;

/** Offline, read-only analysis indexer; never starts beat-link or network listeners. */
public final class AnalysisIndex {
    public static void main(String[] args) throws Exception {
        Class<?> parser = Class.forName("org.deepsymmetry.cratedigger.pdb.RekordboxAnlz");
        try (var input = new BufferedReader(new InputStreamReader(System.in, java.nio.charset.StandardCharsets.UTF_8))) {
            for (String path; (path = input.readLine()) != null;) {
                try {
                    Object analysis = parser.getMethod("fromFile", String.class).invoke(null, path);
                    try {
                        var sections = (List<?>) parser.getMethod("sections").invoke(analysis);
                        List<?> matches = sections.stream().filter(section -> {
                            try { return "SONG_STRUCTURE".equals(String.valueOf(section.getClass().getMethod("fourcc").invoke(section))); }
                            catch (ReflectiveOperationException error) { return false; }
                        }).toList();
                        if (matches.size() != 1) throw new IllegalArgumentException("No unique song structure");
                        Object tag = matches.getFirst().getClass().getMethod("body").invoke(matches.getFirst());
                        Object body = tag.getClass().getMethod("body").invoke(tag);
                        var entries = (List<?>) body.getClass().getMethod("entries").invoke(body);
                        int endBeat = ((Number) body.getClass().getMethod("endBeat").invoke(body)).intValue();
                        var phrases = BeatLinkAdapter.structurePhrases(entries, endBeat);
                        if (phrases.isEmpty() || phrases.size() != entries.size()) throw new IllegalArgumentException("Invalid phrases");
                        System.out.println(Json.write(Map.of("path", path, "phrases", phrases)));
                    } finally {
                        ((AutoCloseable) parser.getMethod("_io").invoke(analysis)).close();
                    }
                } catch (Exception error) {
                    System.out.println(Json.write(Map.of("path", path, "phrases", List.of())));
                }
            }
        }
    }
}

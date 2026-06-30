package com.prodjbeats.bridge;

import java.util.Iterator;
import java.util.Map;

final class Json {
    private Json() {
    }

    static String write(Object value) {
        return switch (value) {
            case null -> "null";
            case String string -> '"' + escape(string) + '"';
            case Number number -> number.toString();
            case Boolean bool -> bool.toString();
            case Map<?, ?> map -> writeMap(map);
            case Iterable<?> iterable -> writeIterable(iterable);
            default -> '"' + escape(value.toString()) + '"';
        };
    }

    private static String writeMap(Map<?, ?> map) {
        StringBuilder builder = new StringBuilder("{");
        Iterator<? extends Map.Entry<?, ?>> iterator = map.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<?, ?> entry = iterator.next();
            builder.append(write(entry.getKey().toString()));
            builder.append(':');
            builder.append(write(entry.getValue()));
            if (iterator.hasNext()) {
                builder.append(',');
            }
        }
        return builder.append('}').toString();
    }

    private static String writeIterable(Iterable<?> iterable) {
        StringBuilder builder = new StringBuilder("[");
        Iterator<?> iterator = iterable.iterator();
        while (iterator.hasNext()) {
            builder.append(write(iterator.next()));
            if (iterator.hasNext()) {
                builder.append(',');
            }
        }
        return builder.append(']').toString();
    }

    private static String escape(String value) {
        StringBuilder builder = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> builder.append("\\\"");
                case '\\' -> builder.append("\\\\");
                case '\b' -> builder.append("\\b");
                case '\f' -> builder.append("\\f");
                case '\n' -> builder.append("\\n");
                case '\r' -> builder.append("\\r");
                case '\t' -> builder.append("\\t");
                default -> {
                    if (character < 0x20) {
                        builder.append(String.format("\\u%04x", (int) character));
                    } else {
                        builder.append(character);
                    }
                }
            }
        }
        return builder.toString();
    }
}

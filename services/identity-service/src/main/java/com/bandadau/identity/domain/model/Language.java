package com.bandadau.identity.domain.model;

public enum Language {
    ES("es"), EN("en");

    private final String code;

    Language(String code) { this.code = code; }

    public String code() { return code; }

    public static Language fromCode(String value) {
        if (value != null) {
            for (Language l : values()) {
                if (l.code.equalsIgnoreCase(value.trim())) return l;
            }
        }
        return ES;
    }
}

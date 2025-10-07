/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable grammar and spell checking",
        default: true
    },
    apiEndpoint: {
        type: OptionType.STRING,
        description: "LanguageTool API URL (base URL or full endpoint with /check)",
        default: "https://api.languagetoolplus.com/v2",
        placeholder: "e.g., http://3.142.129.56:13416/v2/check or http://localhost:8081/v2"
    },
    useCustomServer: {
        type: OptionType.BOOLEAN,
        description: "Use custom LanguageTool server instead of official API",
        default: false
    },
    apiKey: {
        type: OptionType.STRING,
        description: "API key for premium features (optional)",
        default: "",
        placeholder: "Leave empty for free tier"
    },
    language: {
        type: OptionType.SELECT,
        description: "Language for checking",
        options: [
            { label: "Auto-detect", value: "auto", default: true },
            { label: "English (US)", value: "en-US" },
            { label: "English (UK)", value: "en-GB" },
            { label: "Spanish", value: "es" },
            { label: "French", value: "fr" },
            { label: "German", value: "de" },
            { label: "Portuguese", value: "pt" },
            { label: "Italian", value: "it" },
            { label: "Dutch", value: "nl" },
            { label: "Polish", value: "pl" },
            { label: "Russian", value: "ru" },
            { label: "Chinese", value: "zh" },
            { label: "Japanese", value: "ja" }
        ]
    },
    showStyleSuggestions: {
        type: OptionType.BOOLEAN,
        description: "Show style improvement suggestions",
        default: true
    },
    checkGrammar: {
        type: OptionType.BOOLEAN,
        description: "Enable grammar checking",
        default: true
    },
    checkSpelling: {
        type: OptionType.BOOLEAN,
        description: "Enable spell checking",
        default: true
    },
    debounceDelay: {
        type: OptionType.NUMBER,
        description: "Delay (ms) before checking after typing stops",
        default: 600
    },
    maxCharacters: {
        type: OptionType.NUMBER,
        description: "Maximum characters to check per request",
        default: 2000
    },
    enableInDMs: {
        type: OptionType.BOOLEAN,
        description: "Enable in direct messages",
        default: true
    },
    enableInServers: {
        type: OptionType.BOOLEAN,
        description: "Enable in servers",
        default: true
    },
    visualUnderlineStyle: {
        type: OptionType.SELECT,
        description: "Underline style for issues",
        options: [
            { label: "Wavy", value: "wavy", default: true },
            { label: "Solid", value: "solid" },
            { label: "Dotted", value: "dotted" }
        ]
    },
    disableNativeSpellcheck: {
        type: OptionType.BOOLEAN,
        description: "Disable Discord's native spellcheck when plugin is active",
        default: true
    }
});

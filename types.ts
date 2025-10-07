/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface LanguageToolMatch {
    message: string;
    shortMessage: string;
    offset: number;
    length: number;
    replacements: Array<{ value: string; }>;
    context: {
        text: string;
        offset: number;
        length: number;
    };
    sentence: string;
    type: {
        typeName: string;
    };
    rule: {
        id: string;
        description: string;
        issueType: string;
        category: {
            id: string;
            name: string;
        };
    };
    ignoreForIncompleteSentence: boolean;
    contextForSureMatch: number;
}

export interface LanguageToolResponse {
    software: {
        name: string;
        version: string;
        buildDate: string;
        apiVersion: number;
        status: string;
    };
    language: {
        name: string;
        code: string;
        detectedLanguage: {
            name: string;
            code: string;
        };
    };
    matches: LanguageToolMatch[];
}

export interface LanguageToolLanguage {
    name: string;
    code: string;
    longCode: string;
}

export interface CachedCheck {
    text: string;
    response: LanguageToolResponse;
    timestamp: number;
}

export interface IgnoredWord {
    word: string;
    timestamp: number;
}

export interface UnderlinePosition {
    start: number;
    end: number;
    type: "spelling" | "grammar" | "style";
    match: LanguageToolMatch;
}

export type IssueType = "spelling" | "grammar" | "style";

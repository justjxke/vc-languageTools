/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "../settings";
import type { IssueType, LanguageToolMatch, LanguageToolResponse, UnderlinePosition } from "../types";
import { isWordIgnored } from "./cache";

export function parseMatches(response: LanguageToolResponse, text: string): UnderlinePosition[] {
    if (!response || !response.matches) return [];

    const positions: UnderlinePosition[] = [];

    for (const match of response.matches) {
        if (shouldSkipMatch(match, text)) continue;

        const type = categorizeMatch(match);

        if (!shouldShowMatchType(type)) continue;

        const word = text.substring(match.offset, match.offset + match.length);
        if (isWordIgnored(word)) continue;

        positions.push({
            start: match.offset,
            end: match.offset + match.length,
            type,
            match
        });
    }

    return positions;
}

function categorizeMatch(match: LanguageToolMatch): IssueType {
    const issueType = match.rule.issueType.toLowerCase();
    const categoryId = match.rule.category.id.toLowerCase();

    if (issueType.includes("misspelling") || categoryId.includes("typo")) {
        return "spelling";
    }

    if (issueType.includes("style") || categoryId.includes("style") || categoryId.includes("redundancy")) {
        return "style";
    }

    return "grammar";
}

function shouldShowMatchType(type: IssueType): boolean {
    if (type === "spelling" && !settings.store.checkSpelling) return false;
    if (type === "grammar" && !settings.store.checkGrammar) return false;
    if (type === "style" && !settings.store.showStyleSuggestions) return false;
    return true;
}

function shouldSkipMatch(match: LanguageToolMatch, text: string): boolean {
    const matchText = text.substring(match.offset, match.offset + match.length);

    if (isDiscordMarkdown(matchText, text, match.offset)) return true;
    if (isDiscordMention(matchText)) return true;
    if (isDiscordEmoji(matchText)) return true;
    if (isURL(matchText)) return true;
    if (isCodeBlock(text, match.offset)) return true;

    return false;
}

function isDiscordMarkdown(matchText: string, fullText: string, offset: number): boolean {
    const markdownPatterns = [/^\*+$/, /^_+$/, /^~+$/, /^`+$/, /^>+$/];
    return markdownPatterns.some(pattern => pattern.test(matchText));
}

function isDiscordMention(text: string): boolean {
    return /^<@!?\d+>$/.test(text) || /^<@&\d+>$/.test(text) || /^<#\d+>$/.test(text);
}

function isDiscordEmoji(text: string): boolean {
    return /^<a?:\w+:\d+>$/.test(text);
}

function isURL(text: string): boolean {
    try {
        new URL(text);
        return true;
    } catch {
        return /^https?:\/\//.test(text);
    }
}

function isCodeBlock(text: string, offset: number): boolean {
    const beforeText = text.substring(0, offset);
    const afterText = text.substring(offset);

    const codeBlockStart = beforeText.lastIndexOf("```");
    if (codeBlockStart === -1) return false;

    const codeBlockEnd = afterText.indexOf("```");
    if (codeBlockEnd === -1) return false;

    const inlineCodeBefore = (beforeText.match(/`/g) || []).length;
    const inlineCodeAfter = (afterText.match(/`/g) || []).length;

    if (inlineCodeBefore % 2 === 1 && inlineCodeAfter % 2 === 1) {
        return true;
    }

    return codeBlockStart > beforeText.lastIndexOf("```\n");
}

export function getReplacements(match: LanguageToolMatch): string[] {
    return match.replacements
        .slice(0, 5)
        .map(r => r.value);
}

export function applySuggestion(text: string, match: LanguageToolMatch, replacement: string): string {
    return text.substring(0, match.offset) + replacement + text.substring(match.offset + match.length);
}

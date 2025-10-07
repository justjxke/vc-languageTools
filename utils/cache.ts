/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";

import type { CachedCheck, IgnoredWord, LanguageToolResponse } from "../types";

const CACHE_TTL = 5 * 60 * 1000;
const checkCache = new Map<string, CachedCheck>();

export function getCachedCheck(text: string): LanguageToolResponse | null {
    const cached = checkCache.get(text);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > CACHE_TTL) {
        checkCache.delete(text);
        return null;
    }

    return cached.response;
}

export function setCachedCheck(text: string, response: LanguageToolResponse): void {
    checkCache.set(text, {
        text,
        response,
        timestamp: Date.now()
    });

    if (checkCache.size > 50) {
        const oldestKey = Array.from(checkCache.keys())[0];
        checkCache.delete(oldestKey);
    }
}

export function clearCache(): void {
    checkCache.clear();
}

const IGNORED_WORDS_KEY = "LanguageTool_IgnoredWords";
let ignoredWordsCache: Set<string> | null = null;

export async function loadIgnoredWords(): Promise<Set<string>> {
    if (ignoredWordsCache) return ignoredWordsCache;

    try {
        const stored = await DataStore.get(IGNORED_WORDS_KEY);
        const words: IgnoredWord[] = stored || [];
        ignoredWordsCache = new Set(words.map(w => w.word.toLowerCase()));
        return ignoredWordsCache;
    } catch {
        ignoredWordsCache = new Set();
        return ignoredWordsCache;
    }
}

export async function addIgnoredWord(word: string): Promise<void> {
    const words = await loadIgnoredWords();
    const lowerWord = word.toLowerCase();
    words.add(lowerWord);

    const wordsArray: IgnoredWord[] = Array.from(words).map(w => ({
        word: w,
        timestamp: Date.now()
    }));

    await DataStore.set(IGNORED_WORDS_KEY, wordsArray);

    // update cache
    if (ignoredWordsCache) {
        ignoredWordsCache.add(lowerWord);
    }
}

export async function removeIgnoredWord(word: string): Promise<void> {
    const words = await loadIgnoredWords();
    const lowerWord = word.toLowerCase();
    words.delete(lowerWord);

    const wordsArray: IgnoredWord[] = Array.from(words).map(w => ({
        word: w,
        timestamp: Date.now()
    }));

    await DataStore.set(IGNORED_WORDS_KEY, wordsArray);

    // update cache again
    if (ignoredWordsCache) {
        ignoredWordsCache.delete(lowerWord);
    }
}

export function isWordIgnored(word: string): boolean {
    if (!ignoredWordsCache) return false;
    return ignoredWordsCache.has(word.toLowerCase());
}

export async function getIgnoredWords(): Promise<string[]> {
    const words = await loadIgnoredWords();
    return Array.from(words);
}

export async function clearIgnoredWords(): Promise<void> {
    ignoredWordsCache = new Set();
    await DataStore.set(IGNORED_WORDS_KEY, []);
}

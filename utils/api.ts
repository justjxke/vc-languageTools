/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import { settings } from "../settings";
import type { LanguageToolLanguage, LanguageToolResponse } from "../types";
import { getCachedCheck, setCachedCheck } from "./cache";

const logger = new Logger("LanguageTool");

export async function checkText(text: string, language?: string): Promise<LanguageToolResponse | null> {
    if (!text.trim()) return null;

    const cached = getCachedCheck(text);
    if (cached) {
        logger.debug("Using cached result for text");
        return cached;
    }

    let endpoint = settings.store.apiEndpoint.trim();
    // remove trailing slash if present
    if (endpoint.endsWith("/")) {
        endpoint = endpoint.slice(0, -1);
    }
    // if endpoint already ends with /check, don't append it again
    const checkUrl = endpoint.endsWith("/check") ? endpoint : `${endpoint}/check`;

    const { apiKey } = settings.store;
    const lang = language || settings.store.language === "auto" ? "auto" : settings.store.language;

    try {
        const formData = new URLSearchParams();
        formData.append("text", text);
        formData.append("language", lang);

        if (apiKey) {
            formData.append("apiKey", apiKey);
        }

        formData.append("enabledOnly", "false");

        const response = await fetch(checkUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json"
            },
            body: formData.toString()
        });

        if (!response.ok) {
            if (response.status === 429) {
                logger.warn("Rate limit exceeded. Please wait before checking again.");
                return null;
            }
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const result: LanguageToolResponse = await response.json();

        setCachedCheck(text, result);

        return result;
    } catch (error) {
        logger.error("Error checking text:", error);
        return null;
    }
}

export async function getLanguages(): Promise<LanguageToolLanguage[]> {
    let endpoint = settings.store.apiEndpoint.trim();
    // Remove trailing slash if present
    if (endpoint.endsWith("/")) {
        endpoint = endpoint.slice(0, -1);
    }
    // Remove /check if present to get base URL
    if (endpoint.endsWith("/check")) {
        endpoint = endpoint.slice(0, -6);
    }

    try {
        const response = await fetch(`${endpoint}/languages`, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const languages: LanguageToolLanguage[] = await response.json();
        return languages;
    } catch (error) {
        logger.error("Error fetching languages:", error);
        return [];
    }
}

let rateLimitTimeout: NodeJS.Timeout | null = null;
let requestQueue: Array<() => void> = [];
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000;

export function queueCheck(text: string, callback: (result: LanguageToolResponse | null) => void) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest >= MIN_REQUEST_INTERVAL) {
        lastRequestTime = now;
        checkText(text).then(callback);
    } else {
        if (rateLimitTimeout) {
            clearTimeout(rateLimitTimeout);
        }

        requestQueue = [() => {
            lastRequestTime = Date.now();
            checkText(text).then(callback);
        }];

        rateLimitTimeout = setTimeout(() => {
            const nextRequest = requestQueue.shift();
            if (nextRequest) nextRequest();
            rateLimitTimeout = null;
        }, MIN_REQUEST_INTERVAL - timeSinceLastRequest);
    }
}

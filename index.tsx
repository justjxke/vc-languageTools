/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { ComponentDispatch, React } from "@webpack/common";

import { DictionaryModal } from "./components/DictionaryModal";
import { settings } from "./settings";
import type { LanguageToolMatch, UnderlinePosition } from "./types";
import { checkText } from "./utils/api";
import { addIgnoredWord, clearCache, loadIgnoredWords } from "./utils/cache";
import { applySuggestion, parseMatches } from "./utils/parser";

const logger = new Logger("LanguageTool");

let debounceTimer: NodeJS.Timeout | null = null;
let currentTextArea: HTMLElement | null = null;
let currentPositions: UnderlinePosition[] = [];
let currentText: string = "";
let popupElement: HTMLDivElement | null = null;
let underlineElements: HTMLElement[] = [];
const sessionIgnoredWords: Set<string> = new Set(); // temporary ignore per message
let lastTextLength: number = 0; // track text length to detect message sends (cuz when message sent, no more letters)

function getTextFromEditor(editor: HTMLElement): string {
    return editor.textContent || "";
}

function getCursorPosition(): number {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(currentTextArea!);
    preCaretRange.setEnd(range.endContainer, range.endOffset);

    return preCaretRange.toString().length;
}

function setCursorPosition(position: number) {
    if (!currentTextArea) return;

    const selection = window.getSelection();
    if (!selection) return;

    // wait for the text to be inserted
    setTimeout(() => {
        try {
            const textNode = findTextNode(currentTextArea!, position);
            if (textNode) {
                const range = document.createRange();
                range.setStart(textNode.node, textNode.offset);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        } catch (e) {
            logger.warn("Failed to restore cursor position:", e);
        }
    }, 50);
}

function findTextNode(element: HTMLElement, targetPosition: number): { node: Node; offset: number; } | null {
    let currentPosition = 0;

    function traverse(node: Node): { node: Node; offset: number; } | null {
        if (node.nodeType === Node.TEXT_NODE) {
            const textLength = node.textContent?.length || 0;
            if (currentPosition + textLength >= targetPosition) {
                return {
                    node,
                    offset: targetPosition - currentPosition
                };
            }
            currentPosition += textLength;
        } else {
            for (const child of Array.from(node.childNodes)) {
                const result = traverse(child);
                if (result) return result;
            }
        }
        return null;
    }

    return traverse(element);
}

function clearUnderlines() {
    underlineElements.forEach(el => el.remove());
    underlineElements = [];
}

function generateWavyPath(width: number, height: number, wavelength: number): string {
    // Generate smooth sine wave path for spellcheck-style underline
    const amplitude = height / 2;
    const numWaves = Math.ceil(width / wavelength);
    let path = `M 0 ${amplitude}`;

    for (let i = 0; i <= numWaves; i++) {
        const x = i * wavelength;
        const controlX1 = x + wavelength / 4;
        const controlY1 = 0;
        const controlX2 = x + (wavelength * 3) / 4;
        const controlY2 = height;
        const endX = x + wavelength;
        const endY = amplitude;

        // Create smooth bezier curve for each wave
        path += ` C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
    }

    return path;
}

function addVisualUnderlines(positions: UnderlinePosition[], text: string) {
    if (!currentTextArea) return;

    // clear existing underlines
    clearUnderlines();

    logger.info(`[Underlines] Adding ${positions.length} visual underlines`);

    positions.forEach((pos, idx) => {
        const word = text.substring(pos.start, pos.end);
        const color = getColorForType(pos.type);
        const style = settings.store.visualUnderlineStyle;

        logger.info(`[Underlines] Processing word #${idx}: "${word}" at positions ${pos.start}-${pos.end}, type: ${pos.type}`);

        // find the DOM range for this word
        const range = findRangeForPosition(pos.start, pos.end);
        if (!range) {
            logger.warn(`[Underlines] Could not find range for position ${pos.start}-${pos.end}, word: "${word}"`);
            return;
        }

        // get the bounding rectangles for the word (handles multi-line)
        const rects = range.getClientRects();
        logger.info(`[Underlines] Found ${rects.length} rects for word "${word}"`);

        if (rects.length === 0) {
            logger.warn(`[Underlines] No rectangles returned for word "${word}"`);
            return;
        }

        // create underline elements for each line the word spans
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];

            if (rect.width === 0 || rect.height === 0) {
                logger.warn(`[Underlines] Empty rect for word "${word}": width=${rect.width}, height=${rect.height}`);
                continue;
            }

            // create container for underline
            const container = document.createElement("div");
            container.className = "lt-underline-container";
            container.dataset.ltWord = word;
            container.dataset.ltIndex = String(idx);
            container.dataset.ltPosition = JSON.stringify(pos);

            // always disable pointer events on container (clicks go through to text)
            const pointerEvents = "none";

            // create the visual underline
            const underline = document.createElement("div");
            underline.className = "lt-underline";

            if (style === "wavy") {
                // create SVG wavy underline (spellcheck style)
                const waveHeight = 3;
                const wavelength = 4; // Width of each wave

                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("width", String(rect.width));
                svg.setAttribute("height", String(waveHeight));
                svg.style.cssText = "display: block; overflow: visible; pointer-events: none;";

                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                const wavyPath = generateWavyPath(rect.width, waveHeight, wavelength);
                path.setAttribute("d", wavyPath);
                path.setAttribute("stroke", color);
                path.setAttribute("fill", "none");
                path.setAttribute("stroke-width", "1");
                path.setAttribute("stroke-linecap", "round");

                svg.appendChild(path);
                underline.appendChild(svg);

                underline.style.cssText = `
                    width: ${rect.width}px;
                    height: ${waveHeight}px;
                    pointer-events: none;
                `;
            } else {
                // use CSS border for solid/dotted
                const borderStyle = style === "dotted" ? "dotted" : "solid";

                underline.style.cssText = `
                    width: ${rect.width}px;
                    height: 2px;
                    border-bottom: 2px ${borderStyle} ${color};
                    box-sizing: border-box;
                    pointer-events: none;
                `;
            }

            container.appendChild(underline);

            // position the container to cover both the text and underline
            // this makes hovering much easier
            container.style.cssText = `
                position: fixed;
                left: ${rect.left}px;
                top: ${rect.top}px;
                width: ${rect.width}px;
                height: ${rect.height + 4}px;
                pointer-events: ${pointerEvents};
                cursor: default;
                display: flex;
                flex-direction: column;
                justify-content: flex-end;
            `;

            logger.info(`[Underlines] Created underline at x=${rect.left}, y=${rect.bottom}, width=${rect.width}, color=${color}`);

            currentTextArea?.parentElement?.parentElement!.append(container);
            underlineElements.push(container);
        }
    });

    logger.info(`[Underlines] Successfully created ${underlineElements.length} underline elements`);

    // Debug: Log all underline elements
    if (underlineElements.length > 0) {
        logger.info("[Underlines] Underline elements in DOM:", underlineElements.map(el => ({
            word: el.dataset.ltWord,
            visible: el.offsetParent !== null,
            rect: el.getBoundingClientRect()
        })));
    }
}

function findRangeForPosition(start: number, end: number): Range | null {
    if (!currentTextArea) {
        logger.warn("[Underlines] No currentTextArea available");
        return null;
    }

    try {
        logger.info(`[Underlines] Finding range for positions ${start}-${end}`);
        const startNode = findTextNode(currentTextArea, start);
        const endNode = findTextNode(currentTextArea, end);

        if (!startNode) {
            logger.warn(`[Underlines] Could not find start node at position ${start}`);
            return null;
        }
        if (!endNode) {
            logger.warn(`[Underlines] Could not find end node at position ${end}`);
            return null;
        }

        logger.info(`[Underlines] Found nodes - start: ${startNode.node.nodeName} offset ${startNode.offset}, end: ${endNode.node.nodeName} offset ${endNode.offset}`);

        const range = document.createRange();
        range.setStart(startNode.node, startNode.offset);
        range.setEnd(endNode.node, endNode.offset);

        logger.info("[Underlines] Created range successfully");
        return range;
    } catch (e) {
        logger.warn("[Underlines] Error creating range:", e);
        return null;
    }
}

function getColorForType(type: string): string {
    switch (type) {
        case "spelling":
            return "#ed4245";
        case "grammar":
            return "#5865f2";
        case "style":
        case "typographical":
            return "#faa61a";
        default:
            return "#999";
    }
}

function getInfoUrl(match: LanguageToolMatch): string | null {
    const ruleId = match.rule?.id?.toLowerCase() || "";
    const categoryId = match.rule?.category?.id?.toLowerCase() || "";

    // map common rule categories to LanguageTool insights pages
    if (ruleId.includes("uppercase") || categoryId.includes("casing")) {
        return "https://languagetool.org/insights/post/spelling-capital-letters/";
    }
    if (ruleId.includes("comma") || categoryId.includes("comma") || match.message.toLowerCase().includes("comma")) {
        return "https://languagetool.org/insights/post/run-on-sentence-checker/";
    }
    if (categoryId.includes("typography") || ruleId.includes("typography")) {
        return "https://languagetool.org/insights/";
    }
    // default to LanguageTool insights (WHY HAVE THEY GOT SO MANY FUCKING PAGES)
    return "https://languagetool.org/insights/";
}

function showTooltip(position: UnderlinePosition, x: number, y: number) {
    hideTooltip();

    const popup = document.createElement("div");
    popup.className = "lt-popup-modern";

    const { match } = position;
    const word = currentText.substring(match.offset, match.offset + match.length);

    const replacements = match.replacements.slice(0, 5).map(r => r.value);
    const primarySuggestion = replacements[0] || "";
    const infoUrl = getInfoUrl(match);

    popup.innerHTML = `
        <div class="lt-popup-header">
            <div class="lt-popup-drag-handle" title="Drag to move">
                <svg width="16" height="6" viewBox="0 0 16 6" fill="currentColor" opacity="0.3">
                    <circle cx="3" cy="3" r="1.5"/>
                    <circle cx="8" cy="3" r="1.5"/>
                    <circle cx="13" cy="3" r="1.5"/>
                </svg>
            </div>
            <button class="lt-popup-dict-icon-btn" data-action="add-to-dict" title="Add to dictionary">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 2h12v12H2V2zm10 10V4H4v8h8z"/>
                    <path d="M6 6h4v1H6V6zm0 2h4v1H6V8z"/>
                </svg>
            </button>
            <button class="lt-popup-close" title="Close">×</button>
        </div>
        <div class="lt-popup-body">
            <div class="lt-popup-top-row">
                <div class="lt-popup-logo">LT</div>
                <div class="lt-popup-title">Correct</div>
            </div>
            <div class="lt-popup-issue-type">${escapeHtml(match.rule?.category?.name || getTypeLabel(position.type))}</div>
            <div class="lt-popup-message">${escapeHtml(match.message)}</div>
            <div class="lt-popup-suggestions">
                ${replacements.map(r => `
                    <button class="lt-popup-suggestion-btn" data-replacement="${escapeHtml(r)}">
                        ${escapeHtml(r)}
                    </button>
                `).join("")}
                <button class="lt-popup-suggestion-btn lt-popup-ignore-btn" data-action="ignore">Ignore</button>
            </div>
        </div>
    `;

    // position the popup above the word
    const popupWidth = 320;
    const popupHeight = 200; // approximate
    const minBottomMargin = 140; // so its not on the fucking chatbar

    let popupX = x - popupWidth / 2;
    let popupY = y - popupHeight - 10;

    // adjust horizontal position if going off screen
    if (popupX < 10) popupX = 10;
    if (popupX + popupWidth > window.innerWidth - 10) {
        popupX = window.innerWidth - popupWidth - 10;
    }

    // ensure popup doesn't get too close to bottom (chatbar area)
    const maxBottomY = window.innerHeight - minBottomMargin;
    const popupBottom = popupY + popupHeight;

    if (popupBottom > maxBottomY) {
        // move popup higher to avoid chatbar
        popupY = maxBottomY - popupHeight;
        logger.info(`[Popup] Adjusted Y to avoid chatbar: ${popupY}`);
    }

    // If still too high up, show it above the word with more spacing
    if (popupY < 10) {
        popupY = 10;
        popup.classList.add("lt-popup-below");
    }

    popup.style.cssText = `
        position: fixed;
        top: ${popupY}px;
        left: ${popupX}px;
        z-index: 10000;
        width: ${popupWidth}px;
    `;

    document.body.appendChild(popup);
    popupElement = popup;

    // close button
    popup.querySelector(".lt-popup-close")?.addEventListener("click", hideTooltip);

    // drag functionality (just doesnt fucking work, dav if u can fix thid that'd be peak!)
    const dragHandle = popup.querySelector(".lt-popup-drag-handle") as HTMLElement;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let popupStartX = popupX;
    let popupStartY = popupY;

    dragHandle.addEventListener("mousedown", (e: MouseEvent) => {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        popupStartX = popupX;
        popupStartY = popupY;
        dragHandle.style.cursor = "grabbing";
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e: MouseEvent) => {
        if (!isDragging) return;
        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;
        popupX = popupStartX + deltaX;
        popupY = popupStartY + deltaY;
        popup.style.left = `${popupX}px`;
        popup.style.top = `${popupY}px`;
    });

    document.addEventListener("mouseup", () => {
        if (isDragging) {
            isDragging = false;
            dragHandle.style.cursor = "grab";
        }
    });

    // dictionary button (icon in header)
    const dictBtn = popup.querySelector(".lt-popup-dict-icon-btn");
    dictBtn?.addEventListener("mousedown", async e => {
        e.preventDefault();
        e.stopPropagation();

        await addIgnoredWord(word);
        hideTooltip();

        if (currentTextArea) {
            setTimeout(() => handleTextChange(currentTextArea!), 100);
        }
    }, { capture: true });

    const suggestionButtons = popup.querySelectorAll("[data-replacement]");
    logger.info(`Found ${suggestionButtons.length} suggestion buttons`);

    suggestionButtons.forEach((btn, idx) => {
        logger.info(`Button ${idx} data-replacement:`, (btn as HTMLElement).dataset.replacement);

        // use mousedown event (click doesn't work reliably)
        btn.addEventListener("mousedown", e => {
            e.preventDefault();
            e.stopPropagation();

            const replacement = (btn as HTMLElement).dataset.replacement!;

            if (currentTextArea) {
                // save cursor position before replacement
                const cursorPos = getCursorPosition();

                const newText = applySuggestion(currentText, match, replacement);
                logger.info("Applying suggestion:", { old: currentText, new: newText, cursorPos });

                // calculate new cursor position (adjust for length difference)
                const lengthDiff = replacement.length - match.length;
                let newCursorPos = cursorPos;

                // if cursor was after the replaced text, adjust it
                if (cursorPos > match.offset + match.length) {
                    newCursorPos = cursorPos + lengthDiff;
                } else if (cursorPos > match.offset) {
                    // cursor was inside the replaced text, put it at the end of replacement
                    newCursorPos = match.offset + replacement.length;
                }

                // properly clear Discord's editor using ComponentDispatch
                ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");

                // insert the corrected text using ComponentDispatch
                setTimeout(() => {
                    ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
                        rawText: newText,
                        plainText: newText
                    });
                    currentText = newText;

                    // restore cursor position
                    setCursorPosition(newCursorPos);

                    // re-check after insertion
                    setTimeout(() => {
                        if (currentTextArea) {
                            handleTextChange(currentTextArea);
                        }
                    }, 300);
                }, 10);
                // comments galore
                hideTooltip();
            } else {
                logger.error("No current text area!");
            }
        }, { capture: true });
    });

    // handle ignore button, temporarily ignore for current message
    const ignoreBtn = popup.querySelector("[data-action='ignore']");
    ignoreBtn?.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();

        // add to session ignore list (cleared on message send)
        sessionIgnoredWords.add(word.toLowerCase());

        // close popup and refresh
        hideTooltip();

        if (currentTextArea) {
            setTimeout(() => handleTextChange(currentTextArea!), 100);
        }
    }, { capture: true });

    const rect = popup.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        popup.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
        popup.style.top = `${y - rect.height - 10}px`;
    }
}

function hideTooltip() {
    if (popupElement) {
        popupElement.remove();
        popupElement = null;
    }
}

function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function getTypeLabel(type: string): string {
    switch (type) {
        case "spelling": return "Spelling";
        case "grammar": return "Grammar";
        case "style": return "Style";
        default: return "Issue";
    }
}

async function handleTextChange(textArea: HTMLElement) {
    if (!settings.store.enabled) return;

    const text = getTextFromEditor(textArea);
    currentText = text;

    // Detect message send: text went from content to empty/whitespace
    const trimmedText = text.trim();
    const isEmpty = trimmedText.length === 0 || trimmedText === "\uFEFF"; // Check for zero-width char

    if (lastTextLength > 5 && isEmpty) {
        logger.info("[Ignore] Message sent detected (text cleared), clearing ignore list. Had:", Array.from(sessionIgnoredWords));
        sessionIgnoredWords.clear();
        logger.info("[Ignore] Ignore list cleared");
    }
    lastTextLength = trimmedText.length;

    if (!text || text.length === 0) {
        currentPositions = [];
        clearUnderlines();
        return;
    }

    if (text.length > settings.store.maxCharacters) {
        logger.warn(`Text too long: ${text.length} characters`);
        return;
    }

    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
        logger.info(`Checking text: "${text.substring(0, 50)}..."`);
        const response = await checkText(text);

        if (response) {
            const positions = parseMatches(response, text);

            // filter out session-ignored words
            const filteredPositions = positions.filter(pos => {
                const word = text.substring(pos.start, pos.end).toLowerCase();
                return !sessionIgnoredWords.has(word);
            });

            currentPositions = filteredPositions;

            logger.info(`API returned ${response.matches.length} matches, filtered to ${filteredPositions.length} positions`);

            addVisualUnderlines(filteredPositions, text);
            addClickHandlers(textArea, filteredPositions, text);
        } else {
            logger.warn("No response from API");
            currentPositions = [];
            clearUnderlines();
        }
    }, settings.store.debounceDelay);
}

function addClickHandlers(textArea: HTMLElement, positions: UnderlinePosition[], text: string) {
    // add click handler to detect clicks on underlined words
    textArea.removeEventListener("click", handleTextAreaClick);
    textArea.addEventListener("click", handleTextAreaClick);
    logger.info("[LanguageTool] Click handlers added to text area");
}

function handleTextAreaClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    logger.info("Text area clicked", {
        target: target.tagName,
        textContent: target.textContent?.substring(0, 20),
        positionsCount: currentPositions.length
    });

    // get the click position in the text
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!range) return;

    // calculate which character was clicked
    const preRange = document.createRange();
    preRange.selectNodeContents(currentTextArea!);
    preRange.setEnd(range.startContainer, range.startOffset);
    const clickPosition = preRange.toString().length;

    // find if we clicked on an underlined word
    for (const pos of currentPositions) {
        if (clickPosition >= pos.start && clickPosition <= pos.end) {
            logger.info("Clicked on underlined word at position:", clickPosition);
            showTooltip(pos, e.clientX, e.clientY);
            e.stopPropagation();
            e.preventDefault();
            return;
        }
    }
}

function attachToTextArea(textArea: HTMLElement) {
    if (currentTextArea === textArea) return;

    logger.info("Attaching to text area");
    currentTextArea = textArea;

    // disable native spellcheck if setting is enabled (never checked this works lol)
    if (settings.store.disableNativeSpellcheck) {
        textArea.setAttribute("spellcheck", "false");
        logger.info("Disabled native spellcheck on text area");
    }

    const observer = new MutationObserver(() => {
        handleTextChange(textArea);
    });

    observer.observe(textArea, {
        childList: true,
        subtree: true,
        characterData: true
    });

    // clear underlines when user starts typing (they'll reappear after debounce)
    const handleInput = () => {
        clearUnderlines();
        handleTextChange(textArea);
    };

    // update underline positions on scroll/resize
    const handleScroll = () => {
        if (currentPositions.length > 0) {
            addVisualUnderlines(currentPositions, currentText);
        }
    };

    textArea.addEventListener("input", handleInput);
    textArea.addEventListener("blur", hideTooltip);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);

    (textArea as any).__ltObserver = observer;
    (textArea as any).__ltHandleInput = handleInput;
    (textArea as any).__ltHandleScroll = handleScroll;

    handleTextChange(textArea);
}

function findAndAttachTextArea() {
    const textArea = document.querySelector('[role="textbox"][contenteditable="true"]') as HTMLElement;

    if (textArea && !(textArea as any).__ltObserver) {
        attachToTextArea(textArea);
    }
}

export function openDictionaryModal() {
    openModal(props => <DictionaryModal {...props} />);
}

export default definePlugin({
    name: "LanguageTool",
    description: "Real-time grammar and spell checking using LanguageTool API as you type",
    authors: [EquicordDevs.justjxke],
    settings,

    toolboxActions: {
        "Open Personal Dictionary"() {
            openDictionaryModal();
        }
    },

    async start() {
        await loadIgnoredWords();
        clearCache();

        const interval = setInterval(findAndAttachTextArea, 1000);
        (this as any).checkInterval = interval;

        logger.info("LanguageTool plugin started");
        findAndAttachTextArea();
    },

    stop() {
        if ((this as any).checkInterval) {
            clearInterval((this as any).checkInterval);
        }

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        // clean up event listeners
        if (currentTextArea) {
            const handleInput = (currentTextArea as any).__ltHandleInput;
            const handleScroll = (currentTextArea as any).__ltHandleScroll;

            if (handleInput) {
                currentTextArea.removeEventListener("input", handleInput);
            }
            if (handleScroll) {
                window.removeEventListener("scroll", handleScroll, true);
                window.removeEventListener("resize", handleScroll);
            }

            // re-enable native spellcheck if it was disabled (once again not sure if this works)
            if (settings.store.disableNativeSpellcheck) {
                currentTextArea.setAttribute("spellcheck", "true");
                logger.info("Re-enabled native spellcheck");
            }
        }

        hideTooltip();
        clearUnderlines();
        clearCache();
        currentTextArea = null;
        currentPositions = [];
        currentText = "";

        logger.info("LanguageTool plugin stopped");
    }
});

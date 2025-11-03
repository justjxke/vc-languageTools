/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

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

function getCurrentTextArea(): HTMLElement | null {
    // always query for the current text area to handle React re-renders
    const textArea = document.querySelector('[role="textbox"][contenteditable="true"]') as HTMLElement;
    if (textArea && textArea.isConnected) {
        currentTextArea = textArea;
        return textArea;
    }
    return null;
}

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
            // Failed to restore cursor position
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

const canonicalCubicBezierControlPointDistanceForAQuarterCircleArc = (4 / 3) * (Math.sqrt(2) - 1);

function generateWavyPath(width: number, height: number, wavelength: number, offsetY = 0): string {
    const amplitude = height / 2;
    const baseline = offsetY + amplitude;

    const q = wavelength / 4;
    const fullWaves = Math.floor(width / wavelength);
    const remaining = width - fullWaves * wavelength;

    let path = `M 0 ${baseline}`;
    const addCubic = (x0: number, y0: number, x1: number, y1: number) => {
        const dx = x1 - x0;
        const cp1x = x0 + canonicalCubicBezierControlPointDistanceForAQuarterCircleArc * dx;
        const cp1y = y0;
        const cp2x = x1 - canonicalCubicBezierControlPointDistanceForAQuarterCircleArc * dx;
        const cp2y = y1;
        path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x1} ${y1}`;
    };

    for (let i = 0; i < fullWaves; i++) {
        const startX = i * wavelength;
        const x0 = startX;
        const x1 = startX + q;
        const x2 = startX + 2 * q;
        const x3 = startX + 3 * q;
        const x4 = startX + 4 * q;

        addCubic(x0, baseline, x1, baseline - amplitude);
        addCubic(x1, baseline - amplitude, x2, baseline);
        addCubic(x2, baseline, x3, baseline + amplitude);
        addCubic(x3, baseline + amplitude, x4, baseline);
    }

    if (remaining > 1e-9) {
        const startX = fullWaves * wavelength;
        const quarterWidths = [
            Math.min(q, remaining),
            Math.min(q, Math.max(0, remaining - q)),
            Math.min(q, Math.max(0, remaining - 2 * q)),
            Math.min(q, Math.max(0, remaining - 3 * q)),
        ];

        const ys = [
            baseline - amplitude,
            baseline,
            baseline + amplitude,
            baseline,
        ];

        let curX = startX;
        let curY = baseline;
        for (let qi = 0; qi < 4; qi++) {
            const w = quarterWidths[qi];
            if (w <= 0) break;
            const nextX = curX + w;
            const nextY = ys[qi];

            addCubic(curX, curY, nextX, nextY);

            curX = nextX;
            curY = nextY;
        }
    }

    return path;
}

function addVisualUnderlines(positions: UnderlinePosition[], text: string) {
    if (!currentTextArea) return;

    // clear existing underlines
    clearUnderlines();

    positions.forEach((pos, idx) => {
        const word = text.substring(pos.start, pos.end);
        const color = getColorForType(pos.type);
        const style = settings.store.visualUnderlineStyle;

        // find the DOM range for this word
        const range = findRangeForPosition(pos.start, pos.end);
        if (!range) {
            return;
        }

        // get the bounding rectangles for the word (handles multi-line)
        const rects = range.getClientRects();

        if (rects.length === 0) {
            return;
        }

        // create underline elements for each line the word spans
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];

            if (rect.width === 0 || rect.height === 0) {
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

            currentTextArea?.parentElement?.parentElement!.append(container);
            underlineElements.push(container);
        }
    });
}

function findRangeForPosition(start: number, end: number): Range | null {
    if (!currentTextArea) {
        return null;
    }

    try {
        const startNode = findTextNode(currentTextArea, start);
        const endNode = findTextNode(currentTextArea, end);

        if (!startNode) {
            return null;
        }
        if (!endNode) {
            return null;
        }

        const range = document.createRange();
        range.setStart(startNode.node, startNode.offset);
        range.setEnd(endNode.node, endNode.offset);

        return range;
    } catch (e) {
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

function highlightDifferences(original: string, replacement: string): string {
    if (!original || !replacement) {
        return escapeHtml(replacement);
    }
    const origEsc = escapeHtml(original);
    const replEsc = escapeHtml(replacement);
    let start = 0;
    const len = Math.min(origEsc.length, replEsc.length);
    while (start < len && origEsc[start] === replEsc[start]) {
        start++;
    }
    let endOrig = origEsc.length;
    let endRepl = replEsc.length;
    while (endOrig > start && endRepl > start && origEsc[endOrig - 1] === replEsc[endRepl - 1]) {
        endOrig--;
        endRepl--;
    }
    if (start >= endRepl) {
        return `<strong>${replEsc}</strong>`;
    }
    const prefix = replEsc.substring(0, start);
    const changed = replEsc.substring(start, endRepl);
    const suffix = replEsc.substring(endRepl);
    return `${prefix}<strong>${changed}</strong>${suffix}`;
}

function remToPx(rem: number) {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return rem * rootFontSize;
}

const popupWidth = 5;
const popupHeight = 3;

function showTooltip(position: UnderlinePosition, x: number, y: number) {
    hideTooltip();

    const popupHeightAsPx = remToPx(popupHeight);
    const popupWidthAsPx = remToPx(popupWidth);

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
                <svg width="16" height="6" viewBox="0 0 16 6" fill="#aaa" opacity="0.6">
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
                        ${highlightDifferences(word, r)}
                    </button>
                `).join("")}
                <button class="lt-popup-suggestion-btn lt-popup-ignore-btn" data-action="ignore">Ignore</button>
            </div>
        </div>
    `;

    let popupX = x - popupWidthAsPx / 2;
    let popupY = y - popupHeightAsPx - 10;

    // adjust horizontal position if going off screen
    if (popupX < 10) popupX = 10;
    if (popupX + popupWidthAsPx > window.innerWidth - 10) {
        popupX = window.innerWidth - popupWidthAsPx - 10;
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
        width: ${popupWidth}rem;
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
        const rect = popup.getBoundingClientRect();
        popupStartX = rect.left;
        popupStartY = rect.top;
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

    suggestionButtons.forEach((btn, idx) => {
        // use mousedown event (click doesn't work reliably)
        btn.addEventListener("mousedown", e => {
            e.preventDefault();
            e.stopPropagation();

            const replacement = (btn as HTMLElement).dataset.replacement!;

            if (currentTextArea) {
                // save cursor position before replacement
                const cursorPos = getCursorPosition();

                const newText = applySuggestion(currentText, match, replacement);

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
                }, 0);
                // comments galore
                hideTooltip();
            } else {
                // No current text area
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
        sessionIgnoredWords.clear();
    }
    lastTextLength = trimmedText.length;

    if (!text || text.length === 0) {
        currentPositions = [];
        clearUnderlines();
        return;
    }

    if (text.length > settings.store.maxCharacters) {
        return;
    }

    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
        const response = await checkText(text);

        if (response) {
            const positions = parseMatches(response, text);

            // filter out session-ignored words
            const filteredPositions = positions.filter(pos => {
                const word = text.substring(pos.start, pos.end).toLowerCase();
                return !sessionIgnoredWords.has(word);
            });

            currentPositions = filteredPositions;

            addVisualUnderlines(filteredPositions, text);
            addClickHandlers(textArea, filteredPositions, text);
        } else {
            currentPositions = [];
            clearUnderlines();
        }
    }, settings.store.debounceDelay);
}

function addClickHandlers(textArea: HTMLElement, positions: UnderlinePosition[], text: string) {
    // add click handler to detect clicks on underlined words
    textArea.removeEventListener("click", handleTextAreaClick);
    textArea.addEventListener("click", handleTextAreaClick);
}

function handleTextAreaClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // get the current valid text area (handles React re-renders)
    const textArea = getCurrentTextArea();
    if (!textArea) return;

    const textAreaTop = textArea.getBoundingClientRect().top;

    // get the click position in the text
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!range) return;

    // calculate which character was clicked
    const preRange = document.createRange();
    preRange.selectNodeContents(textArea);
    preRange.setEnd(range.startContainer, range.startOffset);
    const clickPosition = preRange.toString().length;

    // find if we clicked on an underlined word
    for (const pos of currentPositions) {
        if (clickPosition >= pos.start && clickPosition <= pos.end) {
            showTooltip(pos, e.clientX, textAreaTop);
            e.stopPropagation();
            e.preventDefault();
            return;
        }
    }
}

function attachToTextArea(textArea: HTMLElement) {
    if (currentTextArea === textArea) return;

    currentTextArea = textArea;

    // disable native spellcheck if setting is enabled (never checked this works lol)
    if (settings.store.disableNativeSpellcheck) {
        textArea.setAttribute("spellcheck", "false");
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
    authors: [
        { name: "justjxke", id: 852558183087472640n },
        { name: "davilarek", id: 568109529884000260n }
    ],
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
            }
        }

        hideTooltip();
        clearUnderlines();
        clearCache();
        currentTextArea = null;
        currentPositions = [];
        currentText = "";

    }
});

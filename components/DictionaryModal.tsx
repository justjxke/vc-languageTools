/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { Button, Forms, React } from "@webpack/common";

import { addIgnoredWord, getIgnoredWords, removeIgnoredWord } from "../utils/cache";

export function DictionaryModal({ transitionState, onClose }: ModalProps) {
    const [words, setWords] = React.useState<string[]>([]);
    const [inputValue, setInputValue] = React.useState("");
    const [hoveredChip, setHoveredChip] = React.useState<string | null>(null);

    React.useEffect(() => {
        loadWords();
    }, []);

    const loadWords = async () => {
        const ignoredWords = await getIgnoredWords();
        setWords(ignoredWords);
    };

    const handleRemove = async (word: string) => {
        await removeIgnoredWord(word);
        await loadWords();
    };

    const handleAddWord = async (word: string) => {
        const trimmed = word.trim().toLowerCase();
        if (trimmed && !words.includes(trimmed)) {
            await addIgnoredWord(trimmed);
            await loadWords();
        }
    };

    const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "," || e.key === "Enter") {
            e.preventDefault();
            if (inputValue.trim()) {
                await handleAddWord(inputValue);
                setInputValue("");
            }
        } else if (e.key === "Backspace" && inputValue === "" && words.length > 0) {
            // remove last word on backspace when input is empty
            const lastWord = words[words.length - 1];
            await handleRemove(lastWord);
        }
    };

    const handleCopyAll = () => {
        const text = words.join(", ");
        navigator.clipboard.writeText(text);
    };

    const handleClearAll = async () => {
        for (const word of words) {
            await removeIgnoredWord(word);
        }
        await loadWords();
    };

    return (
        <ModalRoot transitionState={transitionState} size={ModalSize.SMALL}>
            <ModalHeader>
                <Forms.FormTitle tag="h2">Personal Dictionary</Forms.FormTitle>
                <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalContent style={{ padding: "16px" }}>
                {/* Chip Input Container */}
                <div
                    style={{
                        minHeight: "150px",
                        padding: "12px",
                        background: "var(--input-background, #1e1f22)",
                        border: "1px solid var(--background-tertiary, #3f4147)",
                        borderRadius: "8px",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "6px",
                        alignItems: "flex-start",
                        alignContent: "flex-start",
                        cursor: "text",
                        position: "relative"
                    }}
                    onClick={e => {
                        // Focus input when clicking container
                        const input = (e.currentTarget as HTMLElement).querySelector("input");
                        input?.focus();
                    }}
                >
                    {/* Word Chips */}
                    {words.map(word => (
                        <div
                            key={word}
                            onMouseEnter={() => setHoveredChip(word)}
                            onMouseLeave={() => setHoveredChip(null)}
                            style={{
                                background: "var(--background-modifier-accent)",
                                color: "var(--header-primary, #dbdee1)",
                                padding: "6px 10px",
                                borderRadius: "16px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                fontSize: "14px",
                                height: "28px",
                                lineHeight: "1"
                            }}
                        >
                            <span>{word}</span>
                            <button
                                onClick={() => handleRemove(word)}
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--header-primary, #dbdee1)",
                                    cursor: "pointer",
                                    fontSize: "18px",
                                    padding: "0",
                                    lineHeight: "1",
                                    opacity: hoveredChip === word ? 1 : 0,
                                    transition: "opacity 0.2s ease",
                                    display: "flex",
                                    alignItems: "center"
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ))}

                    {/* Input Field */}
                    <input
                        type="text"
                        className="lt-dictionary-input"
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={words.length === 0 ? "Type words separated by commas..." : ""}
                        style={{
                            background: "transparent",
                            border: "none",
                            outline: "none",
                            color: "var(--header-primary, #dbdee1)",
                            fontSize: "14px",
                            flex: "1 1 auto",
                            minWidth: "120px",
                            height: "28px",
                            padding: "0 4px"
                        }}
                    />
                </div>
            </ModalContent>
            <ModalFooter className="lt-dictionary-footer">
                <Button color={Button.Colors.BRAND} onClick={handleCopyAll} disabled={words.length === 0}>
                    Copy to Clipboard
                </Button>
                <Button color={Button.Colors.RED} onClick={handleClearAll} disabled={words.length === 0}>
                    Clear All
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

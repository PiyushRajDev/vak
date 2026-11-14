import { useState, useRef, useEffect, useId, useCallback } from "react";
import { LANGUAGES, getLanguage } from "../languages";

type LanguagePickerProps = {
    id: string;
    value: string;
    onChange: (code: string) => void;
    label: string;
    disabled?: boolean;
};

export default function LanguagePicker({
    id,
    value,
    onChange,
    label,
    disabled = false,
}: LanguagePickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(-1);

    const listboxId = useId();
    const searchId = useId();
    const containerRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const selected = getLanguage(value);

    const filtered = LANGUAGES.filter((lang) => {
        const q = query.toLowerCase();
        return (
            lang.nativeName.toLowerCase().includes(q) ||
            lang.englishName.toLowerCase().includes(q)
        );
    });

    const closeDropdown = useCallback(() => {
        setOpen(false);
        setQuery("");
        setActiveIndex(-1);
    }, []);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        function handleClick(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                closeDropdown();
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [open, closeDropdown]);

    // Focus search input when opened
    useEffect(() => {
        if (open) {
            setTimeout(() => searchRef.current?.focus(), 10);
        }
    }, [open]);

    // Scroll active option into view
    useEffect(() => {
        if (activeIndex < 0 || !listRef.current) return;
        const item = listRef.current.querySelectorAll<HTMLLIElement>("[role='option']")[activeIndex];
        item?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    function handleTriggerKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
        }
    }

    function handleSearchKeyDown(e: React.KeyboardEvent) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (activeIndex >= 0 && filtered[activeIndex]) {
                selectLanguage(filtered[activeIndex].code);
            }
        } else if (e.key === "Escape") {
            closeDropdown();
        }
    }

    function selectLanguage(code: string) {
        onChange(code);
        closeDropdown();
    }

    return (
        <div className="lang-picker" ref={containerRef}>
            {/* Label */}
            <label className="lang-picker-label" htmlFor={id}>
                {label}
            </label>

            {/* Trigger button */}
            <button
                id={id}
                type="button"
                className={`lang-picker-trigger${open ? " open" : ""}${disabled ? " disabled" : ""}`}
                onClick={() => !disabled && setOpen((o) => !o)}
                onKeyDown={handleTriggerKeyDown}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-label={`${label}: ${selected.nativeName} (${selected.englishName})`}
                disabled={disabled}
            >
                <span className="lang-picker-trigger-native">{selected.nativeName}</span>
                <span className="lang-picker-trigger-english">{selected.englishName}</span>
                <span className="lang-picker-chevron" aria-hidden="true">
                    {open ? "▲" : "▼"}
                </span>
            </button>

            {/* Dropdown */}
            {open && (
                <div className="lang-picker-dropdown" role="presentation">
                    {/* Search */}
                    <div className="lang-picker-search-wrap">
                        <input
                            ref={searchRef}
                            id={searchId}
                            type="search"
                            className="lang-picker-search"
                            placeholder="Search language…"
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setActiveIndex(0);
                            }}
                            onKeyDown={handleSearchKeyDown}
                            aria-label="Search languages"
                            autoComplete="off"
                        />
                    </div>

                    {/* Options list */}
                    <ul
                        ref={listRef}
                        id={listboxId}
                        className="lang-picker-list"
                        role="listbox"
                        aria-label={label}
                        aria-activedescendant={
                            activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
                        }
                    >
                        {filtered.length === 0 ? (
                            <li className="lang-picker-no-results" role="presentation">
                                No languages found
                            </li>
                        ) : (
                            filtered.map((lang, idx) => {
                                const isSelected = lang.code === value;
                                const isActive = idx === activeIndex;
                                return (
                                    <li
                                        key={lang.code}
                                        id={`${listboxId}-opt-${idx}`}
                                        role="option"
                                        aria-selected={isSelected}
                                        className={`lang-picker-option${isSelected ? " selected" : ""}${isActive ? " active" : ""}`}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            selectLanguage(lang.code);
                                        }}
                                        onMouseEnter={() => setActiveIndex(idx)}
                                    >
                                        <span className="lang-opt-native">{lang.nativeName}</span>
                                        <span className="lang-opt-english">{lang.englishName}</span>
                                    </li>
                                );
                            })
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

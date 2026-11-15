import { useEffect, useState } from "react";
import Wordmark from "../components/Wordmark";
import { getLanguage, LANGUAGES } from "../languages";
import { LANDING_SECTION_LANGUAGES, LANDING_TRANSLATIONS } from "./phrases";
import LandingHeroStage from "./LandingHeroStage";
import "./LandingPage.css";

type LandingPageProps = {
    onCreateRoom: () => void;
    onJoinRoom: () => void;
};

export default function LandingPage({
    onCreateRoom,
    onJoinRoom,
}: LandingPageProps) {
    const [hasScrolled, setHasScrolled] = useState(false);

    useEffect(() => {
        const updateScrollState = () => {
            setHasScrolled(window.scrollY > 8);
        };

        updateScrollState();
        window.addEventListener("scroll", updateScrollState, { passive: true });

        return () => {
            window.removeEventListener("scroll", updateScrollState);
        };
    }, []);

    useEffect(() => {
        const root = document.querySelector(".landing-page");
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (!root || reducedMotion || !("IntersectionObserver" in window)) {
            return;
        }

        const targets = root.querySelectorAll<HTMLElement>(
            ".landing-reveal, .landing-reveal-item"
        );

        if (targets.length === 0) {
            return;
        }

        root.classList.add("landing-reveal-ready");

        const observer = new IntersectionObserver(
            entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");
                        observer.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.14, rootMargin: "0px 0px -28px 0px" }
        );

        targets.forEach(target => observer.observe(target));

        return () => {
            observer.disconnect();
            root.classList.remove("landing-reveal-ready");
        };
    }, []);

    return (
        <main className="landing-page" id="top">
            <nav
                className={`landing-nav ${hasScrolled ? "is-scrolled" : ""}`}
                aria-label="Main navigation"
            >
                <a className="landing-wordmark" href="#top" aria-label="Vāk home">
                    <Wordmark size="md" />
                </a>

                <div className="landing-nav-links">
                    <a href="#how-it-works">How it works</a>
                    <a href="#languages">Languages</a>
                    <a href="#under-the-hood">Under the hood</a>
                </div>

                <div className="landing-nav-actions">
                    <button
                        type="button"
                        className="btn btn-ghost landing-nav-join"
                        onClick={onJoinRoom}
                    >
                        Join a room
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary landing-nav-create"
                        onClick={onCreateRoom}
                    >
                        Create a room
                    </button>
                </div>
            </nav>

            <section className="landing-hero" aria-labelledby="landing-hero-title">
                <span className="landing-hero-script" aria-hidden="true">क</span>

                <div className="landing-hero-copy">
                    <h1 id="landing-hero-title">
                        <span>One room.</span>
                        <span>Every language.</span>
                    </h1>
                    <p className="landing-hero-subline">
                        One conversation. Everyone hears it in the language they call home.
                    </p>
                    <div className="landing-hero-actions">
                        <button type="button" className="btn btn-primary" onClick={onCreateRoom}>
                            Create a room
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={onJoinRoom}>
                            Join with a code
                        </button>
                    </div>
                    <p className="landing-hero-note">
                        No sign-up. Runs in your browser. Headphones recommended.
                    </p>
                </div>

                <LandingHeroStage />
            </section>

            <section className="landing-idea landing-section-grid" aria-labelledby="landing-idea-title">
                <header className="landing-idea-heading landing-reveal">
                    <span className="landing-section-label">01 / THE IDEA</span>
                    <h2 id="landing-idea-title">Nobody has to switch.</h2>
                    <p>
                        One sentence. Six scripts. Everyone stays in the conversation.
                    </p>
                </header>

                <div className="landing-script-stack" aria-label="The same sentence in different scripts">
                    {LANDING_SECTION_LANGUAGES.map((code, index) => {
                        const language = getLanguage(code);
                        const phrase = LANDING_TRANSLATIONS[code];

                        return (
                            <div
                                className="landing-script-line landing-reveal-item"
                                key={code}
                                data-line-index={index}
                            >
                                <span className="tile-lang-chip landing-poster-chip">
                                    <span className="tile-lang-native" lang={code}>{language.nativeName}</span>
                                    <span className="tile-lang-en">{language.englishName}</span>
                                </span>
                                <p className="landing-script-native" lang={code}>{phrase.text}</p>
                                <span className="landing-script-gloss" lang="en">
                                    Are you coming to college tomorrow?
                                </span>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="landing-how landing-section" id="how-it-works" aria-labelledby="landing-how-title">
                <header className="landing-section-heading landing-reveal">
                    <span className="landing-section-label">02 / HOW IT WORKS</span>
                    <h2 id="landing-how-title">Speak. Vāk translates. They hear.</h2>
                </header>

                <div className="landing-steps-rail">
                    <article className="landing-step-row">
                        <span className="landing-step-number" aria-hidden="true">01</span>
                        <div className="landing-step-copy">
                            <h3>Speak</h3>
                            <p>Talk the way you normally do, in the language you think in.</p>
                        </div>
                        <span className="landing-step-glyph" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="3" width="6" height="12" rx="3" />
                                <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
                            </svg>
                        </span>
                    </article>

                    <article className="landing-step-row">
                        <span className="landing-step-number" aria-hidden="true">02</span>
                        <div className="landing-step-copy">
                            <h3>Vāk translates</h3>
                            <p>Your speech is transcribed, translated and voiced in the listener's language.</p>
                        </div>
                        <span className="landing-step-glyph" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 5h14M5 10h14M5 15h9M5 20h14" />
                                <path d="M2 5h.01M2 10h.01M2 15h.01M2 20h.01" />
                            </svg>
                        </span>
                    </article>

                    <article className="landing-step-row">
                        <span className="landing-step-number" aria-hidden="true">03</span>
                        <div className="landing-step-copy">
                            <h3>They hear</h3>
                            <p>Each person hears you in their own language, with the original text alongside.</p>
                        </div>
                        <span className="landing-step-glyph" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 9v6h4l5 4V5L8 9H4z" />
                                <path d="M17 9a5 5 0 0 1 0 6M19.5 6.5a9 9 0 0 1 0 11" />
                            </svg>
                        </span>
                    </article>
                </div>
            </section>

            <section className="landing-languages landing-section landing-reveal" id="languages" aria-labelledby="landing-languages-title">
                <header className="landing-languages-heading">
                    <div>
                        <span className="landing-section-label">03 / LANGUAGES</span>
                        <h2 id="landing-languages-title">Speak any. Hear any.</h2>
                    </div>
                    <p>{LANGUAGES.filter(language => language.code !== "en-IN").length} Indian languages, live today.</p>
                </header>

                <div className="landing-language-wall" aria-label="Supported languages">
                    {LANGUAGES.map((language, index) => (
                        <div
                            className={`landing-language-tile landing-language-size-${index % 3}`}
                            key={language.code}
                            lang={language.code}
                            role="group"
                            tabIndex={0}
                            aria-label={`${language.nativeName}, ${language.englishName}`}
                            title={language.englishName}
                        >
                            <span className="landing-language-native">
                                {language.nativeName}
                            </span>
                            <span className="landing-language-english" aria-hidden="true">
                                {language.englishName}
                            </span>
                        </div>
                    ))}
                </div>
            </section>

            <section className="landing-under-hood landing-section" id="under-the-hood" aria-labelledby="landing-under-hood-title">
                <header className="landing-under-hood-heading landing-reveal">
                    <span className="landing-section-label">04 / UNDER THE HOOD</span>
                    <h2 id="landing-under-hood-title">Speech in. Speech out.</h2>
                    <p>
                        A real voice pipeline, from microphone input to translated playback.
                    </p>
                </header>

                <div className="landing-event-log" aria-label="Example event log">
                    <div className="landing-event-log-header">
                        <span>Example event log</span>
                        <span className="landing-event-log-state">SIMULATED FLOW</span>
                    </div>
                    <div className="landing-event-log-body">
                        <div className="landing-event-line landing-reveal-item">
                            <span className="landing-event-tag">STT</span>
                            <span>speech recognized <em>(hi-IN)</em></span>
                            <span className="landing-event-provider">prisma-v3.0</span>
                        </div>
                        <div className="landing-event-line landing-reveal-item">
                            <span className="landing-event-tag">TRN</span>
                            <span>translated <em>(hi → ta)</em></span>
                            <span className="landing-event-provider">sarvam-translate:v1</span>
                        </div>
                        <div className="landing-event-line landing-reveal-item">
                            <span className="landing-event-tag">TTS</span>
                            <span>speech synthesized <em>(ta-IN)</em></span>
                            <span className="landing-event-provider">timbre-v3.0</span>
                        </div>
                        <div className="landing-event-line landing-reveal-item">
                            <span className="landing-event-tag">OUT</span>
                            <span>playback started</span>
                            <span className="landing-event-provider">browser audio</span>
                        </div>
                    </div>
                </div>
            </section>

            <section className="landing-final-band" aria-labelledby="landing-final-title">
                <h2 id="landing-final-title">Say it in yours.</h2>
                <div className="landing-final-actions">
                    <button type="button" className="btn landing-final-primary" onClick={onCreateRoom}>
                        Create a room
                    </button>
                    <button type="button" className="btn landing-final-secondary" onClick={onJoinRoom}>
                        Join with a code
                    </button>
                </div>
            </section>

            <footer className="landing-footer">
                <Wordmark size="sm" />
                <a
                    className="landing-footer-link"
                    href="https://github.com/PiyushRajDev/vak"
                    target="_blank"
                    rel="noreferrer"
                >
                    GitHub
                </a>
                <span className="landing-footer-credit">
                    Built for the Great Indian AI Internship Challenge
                </span>
            </footer>
        </main>
    );
}

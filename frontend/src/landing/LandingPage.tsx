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
                <div className="landing-hero-copy">
                    <h1 id="landing-hero-title">
                        Speak your language.<br />
                        Hear theirs.
                    </h1>
                    <p className="landing-hero-subline">
                        Real-time conversations across Indian languages.
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
                <div className="landing-idea-copy landing-reveal">
                    <span className="landing-eyebrow">The idea</span>
                    <h2 id="landing-idea-title">Nobody has to switch.</h2>
                    <p>
                        One sentence in Hindi. One listener hears Tamil, another hears Kannada.
                        Nobody changes how they talk.
                    </p>
                </div>

                <div className="landing-script-stack" aria-label="The same sentence in different scripts">
                    {LANDING_SECTION_LANGUAGES.map(code => {
                        const language = getLanguage(code);
                        const phrase = LANDING_TRANSLATIONS[code];

                        return (
                            <div className="landing-script-line landing-reveal-item" key={code}>
                                <span className="landing-script-chip">
                                    <span lang={code}>{language.nativeName}</span>
                                    <span>{language.englishName}</span>
                                </span>
                                <p lang={code}>{phrase.text}</p>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="landing-how landing-section" id="how-it-works" aria-labelledby="landing-how-title">
                <div className="landing-section-heading landing-reveal">
                    <span className="landing-eyebrow">How it works</span>
                    <h2 id="landing-how-title">Speak. Vāk translates. They hear.</h2>
                </div>

                <div className="landing-steps-rail">
                    <article className="landing-step">
                        <span className="landing-step-glyph" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="3" width="6" height="12" rx="3" />
                                <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
                                <circle cx="12" cy="9" r="10" strokeOpacity=".24" />
                            </svg>
                        </span>
                        <span className="landing-step-number">01</span>
                        <h3>Speak</h3>
                        <p>Talk the way you normally do, in the language you think in.</p>
                    </article>

                    <article className="landing-step">
                        <span className="landing-step-glyph" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M6 5h12M6 10h12M6 15h8M6 20h12" />
                                <path d="M3 5h.01M3 10h.01M3 15h.01M3 20h.01" />
                            </svg>
                        </span>
                        <span className="landing-step-number">02</span>
                        <h3>Vāk translates</h3>
                        <p>Your speech is transcribed, translated and voiced in the listener's language.</p>
                    </article>

                    <article className="landing-step">
                        <span className="landing-step-glyph" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 9v6h4l5 4V5L8 9H4z" />
                                <path d="M17 9a5 5 0 0 1 0 6M19.5 6.5a9 9 0 0 1 0 11" />
                            </svg>
                        </span>
                        <span className="landing-step-number">03</span>
                        <h3>They hear</h3>
                        <p>Each person hears you in their own language, with the original text alongside.</p>
                    </article>
                </div>
            </section>

            <section className="landing-languages landing-section landing-reveal" id="languages" aria-labelledby="landing-languages-title">
                <div className="landing-languages-heading">
                    <div>
                        <span className="landing-eyebrow">Languages</span>
                        <h2 id="landing-languages-title">Speak any. Hear any.</h2>
                    </div>
                    <p>{LANGUAGES.filter(language => language.code !== "en-IN").length} Indian languages, live today.</p>
                </div>

                <div className="landing-language-wall" aria-label="Supported languages">
                    {LANGUAGES.map(language => (
                        <button
                            type="button"
                            className="landing-language-tile"
                            key={language.code}
                            lang={language.code}
                            aria-label={`${language.nativeName}, ${language.englishName}`}
                            title={language.englishName}
                        >
                            <span className="landing-language-native">
                                {language.nativeName}
                            </span>
                            <span className="landing-language-english" aria-hidden="true">
                                {language.englishName}
                            </span>
                        </button>
                    ))}
                </div>
            </section>

            <section className="landing-use-cases landing-section" aria-labelledby="landing-use-cases-title">
                <div className="landing-use-cases-heading landing-reveal">
                    <h2 id="landing-use-cases-title">Conversations that used to need a translator.</h2>
                </div>
                <div className="landing-use-cases-list">
                    <p className="landing-use-case landing-reveal-item">A family call across states.</p>
                    <p className="landing-use-case landing-reveal-item">A team spread across the country.</p>
                    <p className="landing-use-case landing-reveal-item">A classroom where teacher and students think in different languages.</p>
                </div>
            </section>

            <section className="landing-final-band landing-reveal" aria-labelledby="landing-final-title">
                <h2 id="landing-final-title">Say it in yours.</h2>
                <div className="landing-final-actions">
                    <button type="button" className="btn btn-primary" onClick={onCreateRoom}>
                        Create a room
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={onJoinRoom}>
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

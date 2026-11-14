import { useEffect, useState } from "react";
import Wordmark from "../components/Wordmark";
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

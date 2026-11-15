import { useEffect, useState } from "react";
import ControlDock from "../components/ControlDock";
import ParticipantTiles, {
    type ParticipantTileInfo,
} from "../components/ParticipantTiles";
import { getLanguage } from "../languages";
import { LANDING_PHRASE_SETS } from "./phrases";

type StagePhase =
    | "speaking"
    | "source"
    | "translating"
    | "playing"
    | "hold"
    | "fade";

const PARTICIPANTS: ParticipantTileInfo[] = [
    {
        id: "landing-asha",
        displayName: "Asha",
        spokenLanguage: "hi-IN",
        preferredLanguage: "ta-IN",
        connected: true,
        isMuted: false,
    },
    {
        id: "landing-karthik",
        displayName: "Karthik",
        spokenLanguage: "ta-IN",
        preferredLanguage: "kn-IN",
        connected: true,
        isMuted: false,
    },
    {
        id: "landing-meera",
        displayName: "Meera",
        spokenLanguage: "kn-IN",
        preferredLanguage: "hi-IN",
        connected: true,
        isMuted: false,
    },
];

const splitWords = (value: string) => value.trim().split(/\s+/).filter(Boolean);

export default function LandingHeroStage() {
    const [phraseIndex, setPhraseIndex] = useState(0);
    const [phase, setPhase] = useState<StagePhase>("speaking");
    const [sourceWordCount, setSourceWordCount] = useState(0);
    const [tamilWordCount, setTamilWordCount] = useState(0);
    const [kannadaWordCount, setKannadaWordCount] = useState(0);
    const [prefersReducedMotion] = useState(
        () =>
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );

    const phrase = LANDING_PHRASE_SETS[phraseIndex];
    const sourceWords = splitWords(phrase.sourceText);
    const tamilWords = splitWords(phrase.targets[0].text);
    const kannadaWords = splitWords(phrase.targets[1].text);
    const tamilLanguage = getLanguage("ta-IN");

    useEffect(() => {
        const showFinalFrame = () => {
            setPhase("hold");
            setSourceWordCount(sourceWords.length);
            setTamilWordCount(tamilWords.length);
            setKannadaWordCount(kannadaWords.length);
        };

        if (prefersReducedMotion) {
            showFinalFrame();
            return;
        }

        const timers: number[] = [];
        const later = (delay: number, callback: () => void) => {
            timers.push(window.setTimeout(callback, delay));
        };

        const stream = (
            startAt: number,
            count: number,
            setter: (value: number) => void
        ) => {
            for (let word = 0; word < count; word += 1) {
                later(startAt + word * 80, () => setter(word + 1));
            }
        };

        setPhase("speaking");
        setSourceWordCount(0);
        setTamilWordCount(0);
        setKannadaWordCount(0);

        later(800, () => setPhase("source"));
        stream(880, sourceWords.length, setSourceWordCount);

        later(2800, () => setPhase("translating"));
        later(3400, () => setPhase("playing"));
        stream(3480, tamilWords.length, setTamilWordCount);
        stream(3480, kannadaWords.length, setKannadaWordCount);

        later(6400, () => setPhase("hold"));
        later(8400, () => setPhase("fade"));
        later(9000, () => {
            setPhraseIndex(current => (current + 1) % LANDING_PHRASE_SETS.length);
        });

        return () => {
            timers.forEach(timer => window.clearTimeout(timer));
        };
    }, [
        phraseIndex,
        prefersReducedMotion,
        sourceWords.length,
        tamilWords.length,
        kannadaWords.length,
    ]);

    const statusText =
        phase === "translating"
            ? "Translating…"
            : phase === "playing" || phase === "hold" || phase === "fade"
                ? `Playing in ${tamilLanguage.nativeName}`
                : "You're speaking";

    const sourceCaption = sourceWords.slice(0, sourceWordCount).join(" ");
    const tamilCaption = tamilWords.slice(0, tamilWordCount).join(" ");
    const kannadaCaption = kannadaWords.slice(0, kannadaWordCount).join(" ");

    return (
        <section
            className="landing-stage"
            data-stage-phase={phase}
            aria-label="Preview of a multilingual Vāk room"
        >
            <header className="landing-stage-header">
                <div className="landing-stage-live">
                    <span className="landing-stage-live-dot" aria-hidden="true" />
                    <span>Live room · 3 people</span>
                </div>
                <span className="landing-stage-code">6D03CA</span>
            </header>

            <div className="landing-stage-main">
                <div className="landing-stage-tiles">
                    <ParticipantTiles
                        participants={PARTICIPANTS}
                        selfParticipantId=""
                        activeSpeakerId={null}
                        roomCode="6D03CA"
                        onCopyRoomCode={() => undefined}
                    />
                </div>

                <div className="landing-stage-captions" aria-label="Live captions">
                    <div className="landing-caption-row">
                        <span className="tile-lang-chip">
                            <span className="tile-lang-native" lang="hi-IN">हिन्दी</span>
                            <span className="tile-lang-en">Hindi</span>
                        </span>
                        <div className="landing-caption-copy">
                            <p lang="hi-IN">{sourceCaption}</p>
                            {sourceWordCount > 0 && (
                                <span className="landing-caption-gloss" lang="en">
                                    {phrase.englishGloss}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="landing-caption-row">
                        <span className="tile-lang-chip">
                            <span className="tile-lang-native" lang="ta-IN">தமிழ்</span>
                            <span className="tile-lang-en">Tamil</span>
                        </span>
                        <div className="landing-caption-copy">
                            <p lang="ta-IN">{tamilCaption}</p>
                        </div>
                    </div>

                    <div className="landing-caption-row">
                        <span className="tile-lang-chip">
                            <span className="tile-lang-native" lang="kn-IN">ಕನ್ನಡ</span>
                            <span className="tile-lang-en">Kannada</span>
                        </span>
                        <div className="landing-caption-copy">
                            <p lang="kn-IN">{kannadaCaption}</p>
                        </div>
                    </div>
                </div>

                <div className="landing-preview-dock" aria-hidden="true" inert={true}>
                    <ControlDock
                        micState={statusText}
                        isMuted={false}
                        micError={null}
                        isStarting={false}
                        isDisabled={true}
                        onToggleMic={() => undefined}
                        onRetryMic={() => undefined}
                        spokenLanguage="hi-IN"
                        preferredLanguage="ta-IN"
                        showRail={false}
                        onToggleRail={() => undefined}
                        onOpenDiagnostics={() => undefined}
                        onLeaveRoom={() => undefined}
                    />
                </div>
            </div>

            <span className="landing-stage-status" role="status" aria-live="polite">
                {statusText}
            </span>
        </section>
    );
}

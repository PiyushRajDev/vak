import ParticipantTiles, {
    type CaptionEntry,
    type ParticipantTileInfo,
} from "../components/ParticipantTiles";
import { getScriptGlyph } from "../languages";
import {
    LANDING_SENTENCE_EN,
    LANDING_STAGE_LANGUAGES,
    LANDING_TRANSLATIONS,
} from "./phrases";

const PARTICIPANTS: ParticipantTileInfo[] = [
    {
        id: "landing-hindi",
        displayName: "ह",
        spokenLanguage: "hi-IN",
        preferredLanguage: "ta-IN",
        connected: true,
        isMuted: false,
    },
    {
        id: "landing-tamil",
        displayName: "த",
        spokenLanguage: "ta-IN",
        preferredLanguage: "kn-IN",
        connected: true,
        isMuted: false,
    },
    {
        id: "landing-kannada",
        displayName: "ಕ",
        spokenLanguage: "kn-IN",
        preferredLanguage: "hi-IN",
        connected: true,
        isMuted: false,
    },
];

const CAPTIONS: Record<string, CaptionEntry> = {
    "landing-hindi": {
        text: LANDING_TRANSLATIONS["hi-IN"].text,
        language: "hi-IN",
        gloss: LANDING_SENTENCE_EN,
        active: true,
    },
    "landing-tamil": {
        text: LANDING_TRANSLATIONS["ta-IN"].text,
        language: "ta-IN",
        active: true,
    },
    "landing-kannada": {
        text: LANDING_TRANSLATIONS["kn-IN"].text,
        language: "kn-IN",
        active: true,
    },
};

export default function LandingHeroStage() {
    const languageFor = (code: typeof LANDING_STAGE_LANGUAGES[number]) =>
        code === "hi-IN" ? "Hindi" : code === "ta-IN" ? "Tamil" : "Kannada";

    return (
        <div
            className="landing-stage"
            role="img"
            aria-label="A voice-room preview showing the same sentence in Hindi, Tamil and Kannada."
        >
            <span className="landing-stage-texture" aria-hidden="true">
                {getScriptGlyph("hi-IN")}
            </span>

            <ParticipantTiles
                participants={PARTICIPANTS}
                selfParticipantId=""
                activeSpeakerId={null}
                roomCode=""
                captionMap={CAPTIONS}
                onCopyRoomCode={() => undefined}
            />

            <div className="landing-stage-playing" aria-hidden="true">
                {LANDING_STAGE_LANGUAGES.map(code => (
                    <span key={code} className={`landing-playing-${code.slice(0, 2)}`}>
                        Playing in {languageFor(code)}
                    </span>
                ))}
            </div>
        </div>
    );
}

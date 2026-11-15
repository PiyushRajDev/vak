// Landing-page example phrases.
// Hindi source lines are retained from the previous brief.
// Every non-Hindi line is explicitly UNVERIFIED and requires native-speaker review
// before production use. These examples are not claimed as provider-verified output.

export const LANDING_TRANSLATIONS = {
    "hi-IN": {
        text: "कल कॉलेज आ रहे हो?",
        reviewStatus: "UNVERIFIED",
    },
    "ta-IN": {
        text: "நாளைக்கு நீ காலேஜுக்கு வருகிறாயா?",
        reviewStatus: "UNVERIFIED",
    },
    "kn-IN": {
        text: "ನೀನು ನಾಳೆ ಕಾಲೇಜಿಗೆ ಬರುತ್ತೀಯಾ?",
        reviewStatus: "UNVERIFIED",
    },
    "te-IN": {
        text: "రేపు కాలేజీకి వస్తున్నావా?",
        reviewStatus: "UNVERIFIED",
    },
    "bn-IN": {
        text: "তুমি কি কাল কলেজে আসছ?",
        reviewStatus: "UNVERIFIED",
    },
    "mr-IN": {
        text: "तू उद्या कॉलेजला येतोयस का?",
        reviewStatus: "UNVERIFIED",
    },
} as const;

export const LANDING_SECTION_LANGUAGES = [
    "hi-IN",
    "ta-IN",
    "kn-IN",
    "te-IN",
    "bn-IN",
    "mr-IN",
] as const;

export const LANDING_PHRASE_SETS = [
    {
        sourceLanguage: "hi-IN",
        sourceText: LANDING_TRANSLATIONS["hi-IN"].text,
        sourceReviewStatus: "UNVERIFIED",
        englishGloss: "Are you coming to college tomorrow?",
        targets: [
            {
                languageCode: "ta-IN",
                text: LANDING_TRANSLATIONS["ta-IN"].text,
                reviewStatus: "UNVERIFIED",
            },
            {
                languageCode: "kn-IN",
                text: LANDING_TRANSLATIONS["kn-IN"].text,
                reviewStatus: "UNVERIFIED",
            },
        ],
    },
    {
        sourceLanguage: "hi-IN",
        sourceText: "मैं पाँच मिनट में पहुँचता हूँ।",
        sourceReviewStatus: "UNVERIFIED",
        englishGloss: "I'll be there in five minutes.",
        targets: [
            {
                languageCode: "ta-IN",
                text: "நான் ஐந்து நிமிடங்களில் வந்துவிடுகிறேன்.",
                reviewStatus: "UNVERIFIED",
            },
            {
                languageCode: "kn-IN",
                text: "ನಾನು ಐದು ನಿಮಿಷಗಳಲ್ಲಿ ಬರುತ್ತೇನೆ.",
                reviewStatus: "UNVERIFIED",
            },
        ],
    },
] as const;

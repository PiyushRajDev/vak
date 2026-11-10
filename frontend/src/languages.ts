export type Language = {
    code: string;
    nativeName: string;
    englishName: string;
};

export const LANGUAGES: Language[] = [
    { code: "hi-IN", nativeName: "हिन्दी", englishName: "Hindi" },
    { code: "ta-IN", nativeName: "தமிழ்", englishName: "Tamil" },
    { code: "te-IN", nativeName: "తెలుగు", englishName: "Telugu" },
    { code: "kn-IN", nativeName: "ಕನ್ನಡ", englishName: "Kannada" },
    { code: "bn-IN", nativeName: "বাংলা", englishName: "Bengali" },
    { code: "mr-IN", nativeName: "मराठी", englishName: "Marathi" },
    { code: "gu-IN", nativeName: "ગુજરાતી", englishName: "Gujarati" },
    { code: "ml-IN", nativeName: "മലയാളം", englishName: "Malayalam" },
    { code: "pa-IN", nativeName: "ਪੰਜਾਬੀ", englishName: "Punjabi" },
    { code: "od-IN", nativeName: "ଓଡ଼ିଆ", englishName: "Odia" },
    { code: "en-IN", nativeName: "English", englishName: "English" },
];

export function getLanguage(code?: string): Language {
    if (!code) return { code: "", nativeName: "Unknown", englishName: "Unknown" };
    const found = LANGUAGES.find(l => l.code.toLowerCase() === code.toLowerCase());
    if (found) return found;
    return { code, nativeName: code, englishName: code };
}

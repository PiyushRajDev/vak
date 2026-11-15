# वाक् Vāk

**Speak your language. Hear theirs.**

Vāk is a live voice room where everyone speaks their own language and hears everyone else in theirs. Built for the Gnani Great Indian AI Internship Challenge on Gnani's Prisma (speech recognition) and Timbre (speech synthesis).

[Live demo](LIVE_URL) · [2-3 min demo video](VIDEO_URL) · Source: this repository

## The problem

A conversation needs a shared language before it can start. India has 22 scheduled languages, and a family call across states, a team spread over the country or a classroom with mixed first languages usually defaults to English. The person who thinks fastest in Tamil or Bengali ends up translating in their head.

## The solution

Open a room, pick the language you speak and the one you want to hear, and share the room code. Say something in Hindi: one listener hears it spoken in Tamil, another in Kannada, a moment later. Every screen also shows the original and the translated text, with a live caption on the speaker's tile. Nobody changes how they talk.

## How it works

```
Speaker's mic -> Gnani Prisma     (speech to text)
              -> TRANSLATION_PROVIDER   (translation)
              -> Gnani Timbre     (text to speech)
              -> each listener hears their own language
```

One utterance is translated once per distinct listener language, then spoken to the listeners who chose it. Rooms run over WebSockets from a Node.js backend, and the frontend is built with Vite.

## What's in the product

- 10 Indian languages, plus English
- Meeting-style rooms: participant tiles with a speaking indicator, a conversation panel with original and translated text, and clear mic and connection states
- Runs in the browser with no sign-up
- Deployed on free tiers, with the frontend on Vercel

## Design decisions

- **Nothing is stored.** Rooms live in memory. Audio and transcripts are never written to disk or a database.
- **Tokens stay private.** The participant token lives only in browser memory, never in URLs, room codes or logs.
- **Hardened by default.** WebSocket messages are validated against an allowlist, origins are checked, and room creation, joins and audio throughput are rate limited.
- **Cheap to run.** A 22-call test (4 speech-to-text, 18 text-to-speech) used 2.38 of the 5,000 programme credits.

## Try it

1. Open the live demo, choose **Create a room**, pick your languages and share the code.
2. Join from a second device and choose a different language.
3. Use headphones. The free-tier server can take about a minute to wake on the first visit.

## Built by

Piyush Raj · [GitHub](GITHUB_URL) · [LinkedIn](LINKEDIN_URL) · [Oasix](https://oasix.in), an autonomous AI marketing operator I'm building.

/**
 * Build a Google Translate TTS URL for the given text + BCP-47 language code.
 * The `tw-ob` client identifies as the Translate web TTS button which does
 * not require an API key. Text is truncated to 200 chars because the endpoint
 * silently rejects longer payloads.
 */
export function ttsUrl(text: string, lang = 'en'): string {
  const clipped = text.slice(0, 200);
  const params = new URLSearchParams({
    ie: 'UTF-8',
    client: 'tw-ob',
    tl: lang,
    q: clipped,
  });
  return `https://translate.google.com/translate_tts?${params.toString()}`;
}

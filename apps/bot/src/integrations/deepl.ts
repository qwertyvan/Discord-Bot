import { request } from 'undici';
import { api, ApiError } from '../api-client.js';

interface DeeplResponse {
  translations: Array<{ detected_source_language: string; text: string }>;
}

export interface TranslationResult {
  text: string;
  detectedSource: string;
}

/**
 * Translate text via DeepL. Requires `deepl.api_key` credential set on the
 * guild. Returns null when no key is configured.
 */
export async function translateText(
  guildId: string,
  text: string,
  targetLang: string,
): Promise<TranslationResult | null> {
  let key: string;
  try {
    const cred = await api.getIntegrationCredential(guildId, 'deepl', 'api_key');
    key = cred.value;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
  // DeepL free keys end with ":fx" and use api-free.deepl.com; paid keys use api.deepl.com.
  const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const res = await request(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: {
      authorization: `DeepL-Auth-Key ${key}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ text, target_lang: targetLang.toUpperCase() }).toString(),
  });
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new Error(`DeepL returned ${res.statusCode}: ${body.slice(0, 200)}`);
  }
  const json = (await res.body.json()) as DeeplResponse;
  const tr = json.translations[0];
  if (!tr) throw new Error('DeepL returned no translation.');
  return { text: tr.text, detectedSource: tr.detected_source_language };
}

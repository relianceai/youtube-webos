import kindOf from 'which-builtin-type';

import { configRead } from './config';

/**
 * YouTube's TV (leanback) client returns a truncated `translationLanguages`
 * list in the /player response - typically ~15 entries - while the web client
 * returns the full set. Serbian is one of the languages missing on TV.
 *
 * The translation itself is performed server side by appending `&tlang=<code>`
 * to the timedtext URL, and that endpoint accepts the code regardless of which
 * client requested the caption track. So adding the entry to the list the TV
 * app builds its "Auto-translate" menu from is enough.
 *
 * Same outcome as SmartTube's VideoInfoService.applyFixesIfNeeded(), which
 * re-fetches the player response as AppClient.WEB to obtain the full list -
 * but without the extra request per video.
 */

const LOG_PREFIX = '[subtitle-languages]';

/** [tlang code, English display name] */
const EXTRA_LANGUAGES: ReadonlyArray<readonly [string, string]> = [
  ['sr', 'Serbian (Cyrillic)'],
  ['sr-Latn', 'Serbian (Latin)']
];

/**
 * Injected entries are moved to the head of the list rather than sorted into
 * it. The Auto-translate menu is ~125 entries long on a TV remote, so the
 * languages actually wanted should not require scrolling to reach.
 */
const PIN_TO_TOP = true;

function isObject(value: unknown): value is Record<string, unknown> {
  // @ts-expect-error - bad types
  return kindOf(value) === 'Object';
}

/**
 * YouTube renders language names either as `{ simpleText }` or as
 * `{ runs: [{ text }] }` depending on client/version. Rather than guessing,
 * mirror the shape of whatever entry the server already sent.
 */
function makeLanguageName(template: unknown, text: string) {
  if (isObject(template) && Array.isArray(template.runs)) {
    return { runs: [{ text }] };
  }
  return { simpleText: text };
}

function getDisplayName(entry: unknown): string {
  if (!isObject(entry)) return '';
  const name = entry.languageName;
  if (!isObject(name)) return '';

  if (typeof name.simpleText === 'string') return name.simpleText;

  if (Array.isArray(name.runs)) {
    return name.runs
      .map((run: unknown) =>
        isObject(run) && typeof run.text === 'string' ? run.text : ''
      )
      .join('');
  }

  return '';
}

function extendTracklist(renderer: Record<string, unknown>) {
  const existing = renderer.translationLanguages;

  // Only act on responses that already carry a list. If the field is absent,
  // this video has no translatable captions and adding an option would just
  // produce a dead menu entry.
  if (!Array.isArray(existing) || existing.length === 0) return;

  const present = new Set(
    existing
      .map((entry) =>
        isObject(entry) && typeof entry.languageCode === 'string'
          ? entry.languageCode
          : undefined
      )
      .filter((code): code is string => code !== undefined)
  );

  const nameTemplate = isObject(existing[0])
    ? existing[0].languageName
    : undefined;

  const added: string[] = [];

  for (const [code, name] of EXTRA_LANGUAGES) {
    // Already sent by the server - nothing to do.
    if (present.has(code)) continue;

    existing.push({
      languageCode: code,
      languageName: makeLanguageName(nameTemplate, name)
    });
    added.push(code);
  }

  if (added.length === 0) return;

  // Keep the menu alphabetical, the way the web client presents it.
  existing.sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));

  if (PIN_TO_TOP) {
    const codes = new Set(EXTRA_LANGUAGES.map(([code]) => code));

    const isPinned = (entry: unknown) =>
      isObject(entry) &&
      typeof entry.languageCode === 'string' &&
      codes.has(entry.languageCode);

    // Preserve the order declared in EXTRA_LANGUAGES rather than the
    // alphabetical order they happen to have landed in.
    const pinned = [...EXTRA_LANGUAGES]
      .map(([code]) =>
        existing.find((entry) => isObject(entry) && entry.languageCode === code)
      )
      .filter((entry) => entry !== undefined);

    const rest = existing.filter((entry) => !isPinned(entry));

    existing.splice(0, existing.length, ...pinned, ...rest);
  }

  console.info(
    `${LOG_PREFIX} Added translation languages: ${added.join(', ')}`
  );
}

/**
 * The TV app only offers the Auto-translate submenu for tracks flagged
 * translatable. Auto-generated (ASR) tracks are always translatable server
 * side, so correct the flag when the TV client omits it.
 */
function markAsrTracksTranslatable(renderer: Record<string, unknown>) {
  const tracks = renderer.captionTracks;
  if (!Array.isArray(tracks)) return;

  for (const track of tracks) {
    if (!isObject(track)) continue;
    if (track.kind === 'asr' && track.isTranslatable !== true) {
      track.isTranslatable = true;
    }
  }
}

function patchCaptions(res: unknown) {
  if (!isObject(res)) return;

  // /player responses put captions at the top level; some surfaces nest the
  // player response one level down.
  const containers = [res, res.playerResponse].filter(isObject);

  for (const container of containers) {
    const captions = container.captions;
    if (!isObject(captions)) continue;

    const renderer = captions.playerCaptionsTracklistRenderer;
    if (!isObject(renderer)) continue;

    markAsrTracksTranslatable(renderer);
    extendTracklist(renderer);
  }
}

type JSONReviver = Parameters<typeof JSON.parse>[1];

const originalParse = JSON.parse;

function jsonParse(str: string, reviver?: JSONReviver) {
  const res = originalParse(str, reviver) as unknown;

  if (!configRead('moreSubtitleLanguages')) {
    return res;
  }

  try {
    patchCaptions(res);
  } catch (err) {
    // Never let a parsing edge case break playback.
    console.warn(`${LOG_PREFIX} Failed to patch captions:`, err);
  }

  return res;
}

JSON.parse = jsonParse;

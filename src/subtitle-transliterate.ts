import { configRead } from './config';

/**
 * Google's translator has no Serbian Latin target - `tlang=sr-Latn` is
 * accepted but silently falls back to Cyrillic output. So the "Serbian
 * (Latin)" entry injected by ./subtitle-languages requests the ordinary
 * Serbian translation and this module converts the returned caption text.
 *
 * Serbian Cyrillic to Latin is a strict character-for-character mapping
 * (Gaj's alphabet), so the conversion is lossless. Only the timedtext
 * responses carrying our marker code are touched.
 */

const LOG_PREFIX = '[subtitle-transliterate]';

/** Marker code used by the injected "Serbian (Latin)" menu entry. */
export const LATIN_MARKER = 'sr-Latn';

const MAP: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  ђ: 'đ',
  е: 'e',
  ж: 'ž',
  з: 'z',
  и: 'i',
  ј: 'j',
  к: 'k',
  л: 'l',
  љ: 'lj',
  м: 'm',
  н: 'n',
  њ: 'nj',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  ћ: 'ć',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'č',
  џ: 'dž',
  ш: 'š',
  А: 'A',
  Б: 'B',
  В: 'V',
  Г: 'G',
  Д: 'D',
  Ђ: 'Đ',
  Е: 'E',
  Ж: 'Ž',
  З: 'Z',
  И: 'I',
  Ј: 'J',
  К: 'K',
  Л: 'L',
  Љ: 'Lj',
  М: 'M',
  Н: 'N',
  Њ: 'Nj',
  О: 'O',
  П: 'P',
  Р: 'R',
  С: 'S',
  Т: 'T',
  Ћ: 'Ć',
  У: 'U',
  Ф: 'F',
  Х: 'H',
  Ц: 'C',
  Ч: 'Č',
  Џ: 'Dž',
  Ш: 'Š'
};

/** Uppercase digraphs: "ЉУБАВ" -> "LJUBAV", but "Љубав" -> "Ljubav". */
const UPPER_DIGRAPHS: Readonly<Record<string, string>> = {
  Љ: 'LJ',
  Њ: 'NJ',
  Џ: 'DŽ'
};

const CYRILLIC = /[\u0400-\u04FF]/;

export function toLatin(text: string): string {
  if (!CYRILLIC.test(text)) return text;

  let out = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const mapped = MAP[ch];

    if (mapped === undefined) {
      out += ch;
      continue;
    }

    // A digraph whose following letter is also uppercase belongs to a
    // run of capitals and must be fully capitalised.
    const upperDigraph = UPPER_DIGRAPHS[ch];
    if (upperDigraph !== undefined) {
      const next = text.charAt(i + 1);
      const nextIsUpper =
        next !== '' && CYRILLIC.test(next) && next === next.toUpperCase();
      out += nextIsUpper ? upperDigraph : mapped;
      continue;
    }

    out += mapped;
  }

  return out;
}

/**
 * Caption payloads may arrive as JSON with `\uXXXX` escapes rather than
 * literal characters. Decoding the Cyrillic range first keeps the body valid
 * JSON - those code points need no escaping - and lets one pass handle both.
 */
function decodeCyrillicEscapes(body: string): string {
  return body.replace(/\\u04[0-9a-fA-F]{2}/g, (esc) =>
    String.fromCharCode(parseInt(esc.slice(2), 16))
  );
}

function transliterateBody(body: string): string {
  return toLatin(decodeCyrillicEscapes(body));
}

function shouldTransliterate(url: string): boolean {
  if (!configRead('moreSubtitleLanguages')) return false;
  if (!url.includes('/api/timedtext')) return false;
  return url.includes(`tlang=${LATIN_MARKER}`);
}

/* -------------------------------------------------------------------- */

const originalFetch = window.fetch.bind(window);

window.fetch = async function patchedFetch(resource, init) {
  const res = await originalFetch(resource as RequestInfo, init);

  try {
    const url =
      typeof resource === 'string'
        ? resource
        : resource instanceof Request
          ? resource.url
          : String(resource);

    if (!shouldTransliterate(url)) return res;

    const body = await res.clone().text();
    const converted = transliterateBody(body);
    if (converted === body) return res;

    console.info(`${LOG_PREFIX} Converted captions to Latin script (fetch)`);

    return new Response(converted, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers
    });
  } catch (err) {
    // Never let a conversion failure cost the user their subtitles.
    console.warn(`${LOG_PREFIX} fetch passthrough:`, err);
    return res;
  }
};

/* -------------------------------------------------------------------- */

const XHR = XMLHttpRequest.prototype;
const originalOpen = XHR.open;

const urls = new WeakMap<XMLHttpRequest, string>();

XHR.open = function open(
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  try {
    urls.set(this, String(url));
  } catch {
    /* ignore */
  }
  // @ts-expect-error - variadic passthrough
  return originalOpen.call(this, method, url, ...rest);
} as typeof XHR.open;

/**
 * `responseText` and `response` are read-only accessors on the prototype, so
 * the converted text is installed as an own property on the instance, which
 * shadows them for any later read.
 */
function overrideResponse(xhr: XMLHttpRequest, text: string) {
  const define = (prop: string) => {
    try {
      Object.defineProperty(xhr, prop, {
        configurable: true,
        get: () => text
      });
    } catch {
      /* ignore */
    }
  };

  define('responseText');
  if (xhr.responseType === '' || xhr.responseType === 'text') {
    define('response');
  }
}

const originalSend = XHR.send;

XHR.send = function send(this: XMLHttpRequest, ...args: unknown[]) {
  try {
    const url = urls.get(this);

    if (url !== undefined && shouldTransliterate(url)) {
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== 4) return;

        try {
          const text = this.responseText;
          if (typeof text !== 'string') return;

          const converted = transliterateBody(text);
          if (converted === text) return;

          overrideResponse(this, converted);
          console.info(
            `${LOG_PREFIX} Converted captions to Latin script (xhr)`
          );
        } catch (err) {
          console.warn(`${LOG_PREFIX} xhr passthrough:`, err);
        }
      });
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} xhr setup failed:`, err);
  }

  // @ts-expect-error - variadic passthrough
  return originalSend.apply(this, args);
} as typeof XHR.send;

# Versioning for this fork

Upstream: https://github.com/webosbrew/youtube-webos
Fork base: upstream `0.5.3` (commit f1b3b72)
Fork change: Serbian subtitle auto-translate (`src/subtitle-languages.ts`)

## Scheme

webOS `appinfo.json` requires **exactly three** non-negative integers separated
by dots. `0.5.3.2` is rejected by `ares-package`:

    ares-package ERR! Error: Invalid value <version> : 0.5.3.2
    [Tips]: The app/pkg version number should consist of three non-negative integers

So the fourth component is folded into the patch field:

    patch = (upstream patch) * 100 + (our build number)

| upstream | our build | version   |
| -------- | --------- | --------- |
| 0.5.3    | 2         | `0.5.302` |
| 0.5.3    | 3         | `0.5.303` |
| 0.5.4    | 1         | `0.5.401` |

Read `0.5.302` as "upstream 0.5.3, fork build 02".

## Why this shape

- **Always above upstream.** Upstream's own `0.5.4` has patch `4`; ours has
  patch `401`. Our build always sorts higher, so a stock build offered by the
  Homebrew Channel can never present itself as a newer version and silently
  overwrite the Serbian patch.
- **Monotonic across rebases.** `0.5.302 < 0.5.401`, so moving the fork onto a
  newer upstream is still an upgrade on the TV.
- **Same app id** (`youtube.leanback.v4`) is kept deliberately, so installs are
  in-place updates and the YouTube login and app settings survive.

Set the version in `package.json`; `webpack.config.js` copies it into
`appinfo.json` at build time (`appInfo.version = pkgJson.version`).

## Build and install

    corepack pnpm install
    corepack pnpm run build && corepack pnpm run package
    corepack pnpm exec ares-install --device tvcli youtube.leanback.v4_<version>_all.ipk

The TV must be awake — in standby every port is filtered and both `--getkey`
and install fail with a timeout.

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

## What happens when upstream releases a new version

Nothing automatic. The app is sideloaded, `appinfo.json` sets
`checkUpdateOnLaunch: false`, and the TV keeps running whatever `.ipk` was
installed last. A new upstream release does not touch it.

The one way a stock build could replace this one is the **Homebrew Channel**,
which lists "YouTube AdFree" under the same app id and offers an update when
the published version is higher than the installed one. The versioning scheme
above is what prevents that: our patch field (`302`, `303`, ...) is always
greater than upstream's (`3`, `4`, ...), so a stock release never looks newer.

If a stock build ever does get installed over this one, nothing is lost
permanently - the Serbian entries just disappear from the menu until this fork
is built and installed again.

## Updating this fork onto a new upstream release

    git fetch upstream
    git rebase upstream/main          # or: git merge upstream/main

Only three upstream files are touched by this fork - `src/config.js` (one
config entry) and `src/userScript.ts` (two imports); the rest is new files.
Conflicts should be rare and small.

Then bump the version to match the new upstream base and rebuild:

    # upstream 0.5.4 -> our first build on it is 0.5.401
    corepack pnpm install
    corepack pnpm run lint:all
    corepack pnpm run build && corepack pnpm run package
    corepack pnpm exec ares-install --device tvcli youtube.leanback.v4_0.5.401_all.ipk
    git push origin serbian-subtitles

Worth re-checking after a rebase, since both depend on YouTube's payloads
rather than on upstream's code:

- Serbian still appears at the top of the Auto-translate menu
  (console: `[subtitle-languages] Added translation languages: ...`)
- Serbian (Latin) still renders Latin
  (console: `[subtitle-transliterate] Converted captions to Latin script`)

Use `corepack pnpm run inspect` to reach that console on the TV.

## Troubleshooting: installs "succeed" but the app will not launch

Symptom set seen on 2026-09-10:

- `ares-install` reports `Success`
- files land in `/media/developer/apps/usr/palm/applications/youtube.leanback.v4/`
- `ares-install --list` and `ares-launch --running` are both **empty**
- `ares-launch` prints `Launched application` but the TV shows a
  "YouTube is not installed" dialog and nothing runs
- `ares-inspect` warns `failed forwarding ... => devicePort: 9998`

**Cause: the official YouTube app was installed.** This app deliberately reuses
the app id `youtube.leanback.v4` so that casting from phones keeps working, so
the two cannot coexist - the Content Store copy wins and the dev copy never
registers with SAM. Uninstalling the official YouTube app through the TV UI and
reinstalling this one fixes it immediately.

This is the project's only stated requirement, in the README and on the repo
listing: "BE SURE TO UNINSTALL THE OFFICIAL YOUTUBE TV APP BEFORE INSTALLING".

Reading the diagnostics correctly matters here, because most of them mislead:

| Command                 | Real Luna call                    | What it actually proves                                                       |
| ----------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `ares-install <ipk>`    | `appInstallService/dev/install`   | Only reads an early `state`; "Success" can precede failure                    |
| `ares-install --list`   | `applicationManager/dev/listApps` | Lists **dev apps only** - empty means nothing registered as a dev app         |
| `ares-launch --running` | `applicationManager/dev/running`  | Dev apps only                                                                 |
| `ares-launch <id>`      | `applicationManager/launch`       | Hits the **system** launcher, so its "success" says nothing about the dev app |

Files being present on disk proves staging happened, not registration. `ps` over
ssh proves nothing either: the Developer Mode ssh session is jailed and can see
only its own ~8 processes. The reliable pair is `--list` plus `--running`.

`ares-install --remove youtube.leanback.v4` only removes the **dev** copy. The
Content Store copy has to go through the TV UI.

## Developer Mode installs are temporary

Developer Mode has a **1000 hour limit**; when it expires, apps installed this
way are removed. An LG developer account is also bound to **one TV at a time** -
signing it into another TV logs this one out, disables Developer Mode, and wipes
dev apps. Switching LG accounts on the TV can therefore silently uninstall this
app. Reinstalling is just the `ares-install` line above; no rebuild needed.

Persisting across that would require the Homebrew Channel with root, which is
patched on current firmware for essentially all webOS 5/6/7/9 models. Check
https://cani.rootmy.tv/ before considering it. Root would not have prevented the
app-id collision above.

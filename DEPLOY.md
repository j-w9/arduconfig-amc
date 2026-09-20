# Deploying the experiment

The experiment publishes to **its own** Cloudflare Pages project and **its own**
hostname. Production ArduConfigurator is a different Pages project, deployed
from the app repo, and nothing here can overwrite it.

| | production | this experiment |
| --- | --- | --- |
| Pages project | `arduconfigurator` | `arduconfig-amc` |
| Hostname | `arduconfigurator.com` | `amc.arduconfigurator.com` |
| Deployed from | the app repo | this repo, with the app as a pinned submodule |

Deploying from here is deliberate: the site shows one pinned AMC commit paired
with one pinned app commit, and `dist/build-pins.txt` records which two.

## What is already set up

Done once, and recorded here so it can be rebuilt or revoked:

- **Pages project** `arduconfig-amc` (Direct Upload), serving
  `arduconfig-amc.pages.dev`.
- **Custom domain** `amc.arduconfigurator.com` on that project.
- **An explicit `amc` CNAME** → `arduconfig-amc.pages.dev`, proxied. This one
  matters: the zone has a `*.arduconfigurator.com` wildcard pointing at a
  cloudflared tunnel, and without a specific record the wildcard answers for
  `amc.` and the Pages domain never validates. A specific record beats a
  wildcard, so the explicit CNAME is what makes the hostname work.
- **Repository secrets** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

The token in CI is **scoped**, not the Global API Key: `Cloudflare Pages:Edit`
on the account, plus `DNS:Edit` and `Zone:Read` on `arduconfigurator.com` only,
and it expires. The Global API Key covers every zone and the account's billing
and cannot be narrowed, so it is not a thing to leave sitting in CI. It was used
once, to mint that token.

To replace the token when it expires: create one with those permissions and
`gh secret set CLOUDFLARE_API_TOKEN --repo j-w9/arduconfig-amc`.

## Deploying

`Actions → Deploy AMC experiment → Run workflow`, or push to `main`. The
workflow re-runs both suites before it builds: the port is checked against
CPython and the app's own tests are run, so a deploy cannot publish a build
whose sequence has drifted from upstream's.

## Updating what is pinned

```sh
git -C vendor/MethodicConfigurator fetch && git -C vendor/MethodicConfigurator checkout <commit>
npm run sync            # re-copy the step data and the observed component values
npm run fixtures        # regenerate the CPython parity corpus
npm test                # the corpus is the check that the port still agrees
git add -A && git commit
```

The app submodule moves the same way, on its `amc-guided` branch.

## A known hang: the packed parameter defaults

`runtime.downloadParamPack()` — the MAVFTP read behind the "changed only"
filter, the Default column, and this experiment's capture of settings already
on a vehicle — **can hang indefinitely in the browser**. It neither resolves
nor rejects, so nothing downstream reports anything.

What is established:

- The demo serves the file (`tests/mock-scenario-param-pack.test.mjs`).
- A freshly connected runtime fetches it in about a second
  (`tests/runtime.param-defaults.test.mjs`).
- In the browser, `handleFetchParamDefaults` is entered and the call never
  settles — confirmed by instrumenting it and waiting twenty seconds.

The difference between the two is the app's other MAVFTP activity. The service
serialises transfers through `withExclusiveSession`, a promise chain with no
timeout on the link itself: an earlier operation that never settles leaves every
later one queued forever. That is the shape of what is happening, though the
operation actually holding it has not been identified.

It is an app-level bug rather than an AMC one, and it predates this experiment —
the Parameters view's Default column depends on the same call. The AMC tab now
says when nothing arrived rather than sitting silent, which is the part that was
in scope here.

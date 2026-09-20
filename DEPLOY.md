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

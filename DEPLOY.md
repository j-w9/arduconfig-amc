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

## One-time setup

1. **Create the Pages project.** In the Cloudflare dashboard: Workers & Pages →
   Create → Pages → *Direct Upload*, named `arduconfig-amc`. Direct Upload
   rather than a Git connection, because the build needs this repo *and* its
   submodules, which GitHub Actions is already set up to check out.

2. **Add the custom domain.** In that project → Custom domains →
   `amc.arduconfigurator.com`. Cloudflare creates the CNAME and issues the
   certificate itself, since the zone is already on Cloudflare — no DNS record
   has to be made by hand.

3. **Add the repository secrets** (Settings → Secrets and variables → Actions):

   - `CLOUDFLARE_ACCOUNT_ID` — `67e08e4562c23958a7c588a9e3b87c43`
   - `CLOUDFLARE_API_TOKEN` — a **scoped** token, not the Global API Key:
     - `Account → Cloudflare Pages → Edit` on this account
     - `Zone → DNS → Edit` and `Zone → Zone → Read`, on `arduconfigurator.com`
       only (needed only if the custom domain is ever attached from CI)
     - give it an expiry

   The Global API Key is deliberately not used anywhere here: it cannot be
   scoped, it covers every zone and the account's billing, and a CI secret that
   powerful is worth avoiding when a token limited to one project does the job.

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

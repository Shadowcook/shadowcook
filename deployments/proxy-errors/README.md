# Proxy error page references

Standalone Shadowcook pages for instance operators to copy directly from this repository
to their reverse proxy's local error-document directory. English is the default; German
copies are available in `de/`.

| HTTP status                 | English              | German                     |
| --------------------------- | -------------------- | -------------------------- |
| 500 — Internal Server Error | [500.html](500.html) | [de/500.html](de/500.html) |
| 502 — Bad Gateway           | [502.html](502.html) | [de/502.html](de/502.html) |
| 503 — Service Unavailable   | [503.html](503.html) | [de/503.html](de/503.html) |
| 504 — Gateway Timeout       | [504.html](504.html) | [de/504.html](de/504.html) |

Each HTML file is complete: inline CSS, system fonts, no JavaScript, no external assets,
and no application header or footer. Copy only the files you need; no build or generator
is required to use them. The homepage link assumes Shadowcook is available at `/` on the
same origin; adjust it if the proxy serves these pages on another hostname.

These references are not included in the application build, container image or deployment
archive. They are separate from the existing packaged `errors/50x.html` fallback.

Configure the proxy to serve the chosen local file with its original HTTP error status
and `Cache-Control: no-store`. Limit replacement to page/document requests; retain API
JSON errors. Verify that the error-file location is served locally and excluded from
catch-all upstream proxying. The existing [Apache integration guide](../package/README.md#apache-outage-fallback)
describes local error documents and selective interception; adapt its file mappings to
these per-status files. Test on staging before applying to a live instance.

A reachable proxy can serve these files when its upstream fails. If that proxy itself is
unreachable, an outer CDN such as Cloudflare controls the response.

## Maintaining the references

UI copy comes from `apps/web/src/i18n/proxy-errors.ts` and the existing error dictionaries.
The shared HTML/CSS template is in `scripts/generate-proxy-error-pages.mts`. To update all
committed reference files after editing their copy or template, run from the repo root:

```sh
node scripts/generate-proxy-error-pages.mts
```

The generator is a manual maintenance command; it is not part of a build or deployment.

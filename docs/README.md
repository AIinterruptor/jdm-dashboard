# docs/ — GitHub Pages redirect only

GitHub Pages for this repository is published from **`main` / `/docs`**, and the
only thing here is a redirect to <https://newsph.jdmaisolutions.com/>.

## Why

`jdm-dashboard` was first published on GitHub Pages at
`aiinterruptor.github.io/jdm-dashboard/`. The site now lives at
**newsph.jdmaisolutions.com** (Cloudflare Pages, project `state-of-the-nationph`).

The GitHub copy became a stale snapshot — it had none of the prediction board,
money page, daily note or Operator Pass — so it served a worse version of the
product to anyone holding the old link. It is redirected rather than deleted so
old links, posts and search results still reach the live site.

## ⚠ Do not move Pages back to `/`

Pages was repointed from `/` to `/docs` on 2026-09-10. The repository **root**
`index.html` is the real application (~1.1 MB), deployed to Cloudflare by
`scripts/deploy-pages.sh`. Publishing the root on GitHub Pages again would put a
second, unmaintained copy of the live site back on the internet.

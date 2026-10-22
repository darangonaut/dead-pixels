#!/usr/bin/env bash
# Zostaví hru a nahrá ju do vetvy gh-pages (GitHub Pages: https://darangonaut.github.io/dead-pixels/).
set -euo pipefail
cd "$(dirname "$0")/.."

remote="$(git remote get-url origin)"
email="$(git config user.email)"
name="$(git config user.name)"
revision="$(git rev-parse --short HEAD)"

npm run build
# Súbory predošlých nasadení zostanú: otvorená stará stránka si ešte môže dotiahnuť svoje
# súbory (napr. mapu), kým sa obnoví — inak by ostala čierna.
if git fetch -q "$remote" gh-pages 2>/dev/null; then
  git archive FETCH_HEAD assets | tar -x -k -C dist 2>/dev/null || true
fi
cd dist
touch .nojekyll # GitHub Pages nemá spracovať súbory cez Jekyll
git init -q -b gh-pages
git add -A
git -c user.email="$email" -c user.name="$name" commit -q -m "Nasadenie $revision"
# Prihlásenie cez GitHub CLI len pre tento push (bez zmeny globálnej konfigurácie gitu).
if command -v gh >/dev/null; then
  git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q -f "$remote" gh-pages
else
  git push -q -f "$remote" gh-pages
fi
rm -rf .git
echo "Nasadené: $revision"

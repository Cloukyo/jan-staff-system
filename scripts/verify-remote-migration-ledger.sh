#!/usr/bin/env bash
set -euo pipefail

label="${1:?environment label is required}"
database_url="${2:?database URL is required}"
repo_versions="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sed -E 's/^([0-9]+)_.*/\1/' | sort)"
remote_versions="$(psql "$database_url" -AtX -c 'select version from supabase_migrations.schema_migrations order by version')"

if [[ "$repo_versions" != "$remote_versions" ]]; then
  echo "$label migration ledger does not exactly match the repository." >&2
  diff -u <(printf '%s\n' "$repo_versions") <(printf '%s\n' "$remote_versions") >&2 || true
  exit 1
fi

echo "$label migration ledger matches the repository (${repo_versions##*$'\n'})."

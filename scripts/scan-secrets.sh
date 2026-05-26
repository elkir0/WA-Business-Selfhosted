#!/usr/bin/env bash
# Run gitleaks against the working tree AND the full git history.
# Use this before any push, especially before the first public push.
#
# Exit codes:
#   0 — no leaks found
#   1 — leaks detected (review the report)
#   2 — gitleaks not installed

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${REPO_ROOT}" ]; then
  echo "Error: not inside a git repository." >&2
  exit 1
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "Error: gitleaks is not installed. Install it first:" >&2
  echo "  brew install gitleaks" >&2
  echo "  # or download from https://github.com/gitleaks/gitleaks/releases" >&2
  exit 2
fi

cd "${REPO_ROOT}"

echo "==> Scanning working tree (uncommitted + staged)..."
gitleaks detect --no-banner --redact --config .gitleaks.toml --source . --report-path gitleaks-report-worktree.json

echo "==> Scanning full git history..."
gitleaks detect --no-banner --redact --config .gitleaks.toml --log-opts="--all" --report-path gitleaks-report-history.json

echo "==> No leaks found."

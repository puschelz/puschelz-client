# AGENTS

## Repo-Local Skills

- `electron-pro`: `.codex/skills/electron-pro/SKILL.md`

Scope policy:

1. Keep Electron-specific skills vendored in this repository under `.codex/skills/`.
2. Do not install Electron skills into `~/.codex/skills` for this project.
3. When updating this skill, modify the repo-local copy only.

## CI Sync Rule

When changing build tooling, packaging tooling, or dependency managers/scripts, update matching GitHub Actions workflows in the same PR.

Required checks for such changes:

1. Update workflow commands to use repo scripts (avoid ad-hoc `npx` install/run in CI for core build tooling).
2. Confirm workflow artifact upload paths still match actual output paths.
3. Run the local equivalent command (`npm run dist` or replacement) before merge.
4. Include a short note in the PR description listing which workflow files were updated.

Examples:

- If migrating `electron-builder` to Electron Forge, replace `npx electron-builder ...` in workflows with `npm run dist` (or current canonical script).
- If output paths change, update release upload globs accordingly.

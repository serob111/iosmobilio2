#!/usr/bin/env bash
# PreToolUse hook (Bash tool): caps the output of npm test / npx vitest /
# npx playwright commands so a verbose run doesn't dump unbounded text into
# the conversation. Relies only on node (already a hard project dependency,
# engines.node in package.json) instead of jq, so it works identically in
# Git Bash on Windows and on Linux GitHub Actions runners without an extra
# tool to install.
set -eu

node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
const command = data.tool_input && data.tool_input.command;
if (typeof command !== "string") process.exit(0);

const isTestCommand = /\b(npm\s+(run\s+)?test\b|npx\s+vitest\b|npx\s+playwright\b)/.test(command);
const alreadyCapped = /\btail\b/.test(command);

if (isTestCommand && !alreadyCapped) {
  const updatedInput = Object.assign({}, data.tool_input, {
    command: command + " 2>&1 | tail -n 120",
  });
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput,
    },
  }));
}
'

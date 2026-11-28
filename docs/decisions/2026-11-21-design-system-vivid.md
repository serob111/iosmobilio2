# Design system: Vivid

**Date:** 2026-11-21 (`75311b6`, "add Mobilio Vivid design export (screens, source,
tokens)"), wired into `apps/web` the next day (`f8fcff2`, 2026-11-22, "wire Vivid design
tokens/fonts and add Foundations UI kit").

**Decision:** Adopt "Vivid" as Mobilio's own design system for the web product (landing,
pricing, editor UI) and, going forward, the shell's branded chrome. Source files live in
`docs/design` (exported from `mobilio-design-docs/`).

**Why:** A named, exported design system (tokens, fonts, a Foundations UI kit) gives the
`design-web` branch a fixed target to build layout against, independent of whoever is
writing markup — see [[STATUS]]'s "parallel branch: design-web" section — rather than each
page inventing its own spacing/color/type choices ad hoc.

**Rejected:** N/A — no competing design system was evaluated; this is the first and only one
adopted.

See [[STATUS]].

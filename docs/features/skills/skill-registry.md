# Skill Registry

Plugin system for grouping tools into activatable skills with lazy activation via placeholder tools.
Inactive skills appear to the LLM as a single `use_<skill>` tool; calling it activates all that skill's real tools.

Defined in `src/lib/agent/skills/index.ts`. Declares the `Skill` interface
(`name`, `description`, `tools`, `alwaysActive`) and exports `getActiveTools`,
`getToolsForState(activeSkillNames)`, `getAllPossibleTools`, `getSkillPlaceholderTools`,
and `getSkillNameFromPlaceholder`. In `graph.ts`, the `toolsWithActivation` wrapper
detects `use_*` calls and appends the skill name to `state.activeSkills`, so on the
next `callModel` iteration the real tools from that skill become visible to the LLM.
The registry currently contains: `core`, `filesystem`, `camofox`, `scraping`.

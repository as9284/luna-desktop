// Luna's system prompt now lives in editable files (SOUL.md + AGENTS.md + skills + memory),
// composed in the main process — see electron/soul/. Response style (wit / length / format) is
// governed by the Luna profile, so chat uses a single balanced sampling temperature.
export const CHAT_TEMPERATURE = 0.7

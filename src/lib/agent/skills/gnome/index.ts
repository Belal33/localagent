import { Skill } from "../index";
import { getGnomeMcpUrl } from "./shared";
import { gnomeTools } from "./tools";

export const gnomeSkill: Skill = {
    name: "gnome",
    description:
        "GNOME desktop control through the host gnome-mcp-server. " +
        "Use for Ubuntu/GNOME notifications, launching apps, opening files, wallpaper, volume, media playback, quick settings, screenshots, window management, and keyring operations.",
    tools: gnomeTools,
    alwaysActive: false,
    onActivate: async () =>
        `GNOME MCP endpoint: ${getGnomeMcpUrl()}. If tools fail to connect, verify GNOME_MCP_COMMAND or the Docker HTTP bridge.`,
};

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { callGnomeTool, callGnomeToolWithFallback } from "./shared";
import { fallbackWindowManagement } from "./window-x11";
import { basename, join } from "node:path";
import { stat } from "node:fs/promises";
import { SCREENSHOT_ARTIFACT_DIR, screenshotArtifactUrl } from "../../screenshot-artifacts";

const booleanLike = z.union([z.boolean(), z.string(), z.number()]);
const SCREENSHOT_SYNC_TIMEOUT_MS = 5_000;
const SCREENSHOT_SYNC_POLL_MS = 100;

/**
 * Normalize anything an LLM might emit into a real JSON boolean.
 * The upstream Rust MCP server uses `serde_json::Value::as_bool()` which
 * rejects strings, numbers, and missing keys — so we must coerce here.
 * Returns undefined when the input is not a recognizable boolean shape,
 * so the caller can omit the field entirely.
 */
function coerceBool(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        if (["true", "1", "yes", "y", "on"].includes(v)) return true;
        if (["false", "0", "no", "n", "off"].includes(v)) return false;
    }
    return undefined;
}

const gnomeSendNotification = new DynamicStructuredTool({
    name: "gnome_send_notification",
    description:
        "Send a native GNOME desktop notification to the user. Use for alerts, reminders, and short status updates.",
    schema: z.object({
        summary: z.string().describe("Notification title"),
        body: z.string().describe("Notification body text"),
    }),
    func: async ({ summary, body }) => {
        return callGnomeTool("send_notification", { summary, body });
    },
});

const gnomeLaunchApplication = new DynamicStructuredTool({
    name: "gnome_launch_application",
    description:
        "Launch a GNOME application by desktop name or executable, such as Firefox, Files, Terminal, or Settings.",
    schema: z.object({
        app_name: z
            .string()
            .describe("Application name or executable to launch, e.g. 'Firefox' or 'org.gnome.Nautilus'"),
    }),
    func: async ({ app_name }) => {
        return callGnomeTool("launch_application", { app_name });
    },
});

const gnomeOpenFile = new DynamicStructuredTool({
    name: "gnome_open_file",
    description:
        "Open a local file, directory, or URL with the user's default GNOME application.",
    schema: z.object({
        path: z.string().describe("File path, directory path, or URL to open"),
    }),
    func: async ({ path }) => {
        return callGnomeTool("open_file", { path });
    },
});

const gnomeSetWallpaper = new DynamicStructuredTool({
    name: "gnome_set_wallpaper",
    description:
        "Set the GNOME desktop wallpaper from a local JPG, JPEG, or PNG image path on the host.",
    schema: z.object({
        image_path: z
            .string()
            .describe("Absolute host path to a JPG, JPEG, or PNG image file"),
    }),
    func: async ({ image_path }) => {
        return callGnomeTool("set_wallpaper", { image_path });
    },
});

const gnomeSetVolume = new DynamicStructuredTool({
    name: "gnome_set_volume",
    description:
        "Set, mute, unmute, or adjust GNOME system volume. Use either an absolute volume or relative direction.",
    schema: z.object({
        volume: z
            .number()
            .min(0)
            .max(100)
            .optional()
            .describe("Absolute volume level from 0 to 100"),
        mute: booleanLike.optional().describe("Mute or unmute audio"),
        relative: booleanLike
            .optional()
            .describe("Whether the change is relative instead of absolute"),
        direction: z
            .enum(["up", "down"])
            .optional()
            .describe("Adjust volume by the configured step in this direction"),
    }),
    func: async ({ volume, mute, relative, direction }) => {
        const muteBool = coerceBool(mute);
        const relativeBool = coerceBool(relative);
        return callGnomeTool("set_volume", {
            ...(volume !== undefined && { volume }),
            ...(muteBool !== undefined && { mute: muteBool }),
            ...(relativeBool !== undefined && { relative: relativeBool }),
            ...(direction && { direction }),
        });
    },
});

const gnomeMediaControl = new DynamicStructuredTool({
    name: "gnome_media_control",
    description:
        "Control active GNOME media playback: play, pause, toggle, stop, next, or previous.",
    schema: z.object({
        action: z
            .enum(["play", "pause", "play_pause", "stop", "next", "previous"])
            .describe("Media action to perform"),
        player: z
            .string()
            .optional()
            .describe("Optional specific MPRIS player name; omit to use the active player"),
    }),
    func: async ({ action, player }) => {
        return callGnomeTool("media_control", {
            action,
            ...(player && { player }),
        });
    },
});

const gnomeQuickSettings = new DynamicStructuredTool({
    name: "gnome_quick_settings",
    description:
        "Toggle GNOME quick settings such as Wi-Fi, Bluetooth, night light, do-not-disturb, or dark style.",
    schema: z.object({
        setting: z
            .enum(["wifi", "bluetooth", "night_light", "do_not_disturb", "dark_style"])
            .describe("GNOME quick setting to change"),
        enabled: booleanLike.describe("Whether to enable or disable the setting"),
    }),
    func: async ({ setting, enabled }) => {
        const enabledBool = coerceBool(enabled);
        if (enabledBool === undefined) {
            return "Error: 'enabled' must be a boolean (true/false).";
        }
        return callGnomeTool("quick_settings", { setting, enabled: enabledBool });
    },
});

const gnomeTakeScreenshot = new DynamicStructuredTool({
    name: "gnome_take_screenshot",
    description:
        "Take a GNOME screenshot. Set interactive=true to show the user's selection dialog.",
    schema: z.object({
        interactive: booleanLike
            .optional()
            .describe("Show GNOME's interactive screenshot selection dialog"),
    }),
    func: async ({ interactive }) => {
        const interactiveBool = coerceBool(interactive);
        const result = await callGnomeTool("take_screenshot", {
            ...(interactiveBool !== undefined && { interactive: interactiveBool }),
        });

        return copyScreenshotToWorkspace(result);
    },
});

async function copyScreenshotToWorkspace(result: string): Promise<string> {
    const hostPath = extractScreenshotPath(result);
    if (!hostPath) return result;

    const fileName = basename(hostPath);
    const workspacePath = join(SCREENSHOT_ARTIFACT_DIR, fileName);
    const synced = await waitForFile(workspacePath, SCREENSHOT_SYNC_TIMEOUT_MS);
    if (synced) {
        return `${result}\nScreenshot available for vision inspection: ${workspacePath}\nScreenshot available in client: ${screenshotArtifactUrl(fileName)}`;
    }

    return `${result}\nScreenshot sync target for vision inspection: ${workspacePath}\nThe file was not visible in the workspace within ${SCREENSHOT_SYNC_TIMEOUT_MS}ms; ask the user to confirm the screenshot sync helper is running via npm run dev:full/prod:full.`;
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const info = await stat(path);
            if (info.isFile() && info.size > 0) return true;
        } catch {
            // Keep polling until the host-side screenshot sync catches up.
        }
        await new Promise((resolve) => setTimeout(resolve, SCREENSHOT_SYNC_POLL_MS));
    }
    return false;
}

function extractScreenshotPath(result: string): string | null {
    const match = result.match(/(?:file:\/\/)?(\/[^\r\n]*?\.(?:png|jpe?g|webp))/i);
    return match ? decodeURIComponent(match[1]) : null;
}

const gnomeWindowManagement = new DynamicStructuredTool({
    name: "gnome_window_management",
    description:
        "Manage GNOME windows: list, focus, close, minimize, maximize, workspace switching, geometry, position, size, or snap. REQUIRES GNOME Shell unsafe mode to be enabled BEFORE use (Alt+F2 → lg → global.context.unsafe_mode = true). If you see 'Script execution failed', unsafe mode is likely disabled or your GNOME Shell version is incompatible.",
    schema: z.object({
        action: z
            .enum([
                "list",
                "focus",
                "close",
                "minimize",
                "maximize",
                "switch_workspace",
                "move_to_workspace",
                "get_geometry",
                "set_geometry",
                "set_position",
                "set_size",
                "snap",
            ])
            .describe("Window management action"),
        window_id: z.string().optional().describe("Window ID for window-specific actions"),
        workspace: z.number().int().optional().describe("0-indexed workspace number"),
        x: z.number().int().optional().describe("X coordinate in pixels"),
        y: z.number().int().optional().describe("Y coordinate in pixels"),
        width: z.number().int().optional().describe("Window width in pixels"),
        height: z.number().int().optional().describe("Window height in pixels"),
        position: z
            .enum(["left", "right"])
            .optional()
            .describe("Snap position for the snap action"),
    }),
    func: async ({ action, window_id, workspace, x, y, width, height, position }) => {
        const args = {
            action,
            ...(window_id && { window_id }),
            ...(workspace !== undefined && { workspace }),
            ...(x !== undefined && { x }),
            ...(y !== undefined && { y }),
            ...(width !== undefined && { width }),
            ...(height !== undefined && { height }),
            ...(position && { position }),
        };

        const result = await callGnomeTool("window_management", args);
        if (!isUnsafeModeFailure(result)) return result;

        return fallbackWindowManagement(args);
    },
});

function isUnsafeModeFailure(result: string): boolean {
    return /Script execution failed|unsafe mode|Access denied/i.test(result);
}

const gnomeKeyring = new DynamicStructuredTool({
    name: "gnome_keyring",
    description:
        "Store, retrieve, or delete secrets in GNOME Keyring via libsecret. Use only when the user explicitly asks to manage secrets.",
    schema: z.object({
        action: z.enum(["store", "retrieve", "delete"]).describe("Keyring action"),
        label: z
            .string()
            .optional()
            .describe("Human-readable label for the secret; required for store"),
        secret: z.string().optional().describe("Secret value; required for store"),
        attributes: z
            .string()
            .optional()
            .describe('JSON object string for lookup attributes, e.g. {"service":"github","user":"me"}'),
    }),
    func: async ({ action, label, secret, attributes }) => {
        return callGnomeToolWithFallback("keyring_management", "keyring", {
            action,
            ...(label && { label }),
            ...(secret && { secret }),
            ...(attributes && { attributes }),
        });
    },
});

export const gnomeTools = [
    gnomeSendNotification,
    gnomeLaunchApplication,
    gnomeOpenFile,
    gnomeSetWallpaper,
    gnomeSetVolume,
    gnomeMediaControl,
    gnomeQuickSettings,
    gnomeTakeScreenshot,
    gnomeWindowManagement,
    gnomeKeyring,
];

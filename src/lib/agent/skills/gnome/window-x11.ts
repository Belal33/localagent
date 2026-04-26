import { execFile } from "node:child_process";

type WindowManagementArgs = {
    action: string;
    window_id?: string;
    workspace?: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    position?: string;
};

type Geometry = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type WindowState = {
    minimized: boolean;
    maximized: boolean;
};

const COMMAND_TIMEOUT_MS = 5_000;

export async function fallbackWindowManagement(
    args: WindowManagementArgs
): Promise<string> {
    const display = getX11Display();
    if (!display) {
        return "GNOME window management requires either GNOME Shell unsafe mode or an X11 DISPLAY on the host.";
    }

    try {
        switch (args.action) {
            case "list":
                return listWindows();
            case "focus":
                return focusWindow(requireWindowId(args));
            case "close":
                return closeWindow(requireWindowId(args));
            case "minimize":
                return minimizeWindow(requireWindowId(args));
            case "maximize":
                return maximizeWindow(requireWindowId(args));
            case "switch_workspace":
                return switchWorkspace(requireNumber(args.workspace, "workspace"));
            case "move_to_workspace":
                return moveToWorkspace(
                    requireWindowId(args),
                    requireNumber(args.workspace, "workspace")
                );
            case "get_geometry":
                return getGeometryMessage(requireWindowId(args));
            case "set_geometry":
                return setGeometry(requireWindowId(args), {
                    x: requireNumber(args.x, "x"),
                    y: requireNumber(args.y, "y"),
                    width: requireNumber(args.width, "width"),
                    height: requireNumber(args.height, "height"),
                });
            case "set_position":
                return setPosition(
                    requireWindowId(args),
                    requireNumber(args.x, "x"),
                    requireNumber(args.y, "y")
                );
            case "set_size":
                return setSize(
                    requireWindowId(args),
                    requireNumber(args.width, "width"),
                    requireNumber(args.height, "height")
                );
            case "snap":
                return snapWindow(requireWindowId(args), requirePosition(args.position));
            default:
                return `Unknown window action: ${args.action}`;
        }
    } catch (error) {
        return (
            "GNOME Shell window_management failed, and the X11 fallback also failed. " +
            `${error instanceof Error ? error.message : String(error)}`
        );
    }
}

async function listWindows(): Promise<string> {
    const [wmctrlOut, activeId] = await Promise.all([
        run("wmctrl", ["-lx"]),
        getActiveWindowId().catch(() => undefined),
    ]);

    const windows = await Promise.all(
        wmctrlOut
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map(async (line) => {
                const parsed = parseWmctrlLine(line);
                if (!parsed) return undefined;

                const [geometry, state] = await Promise.all([
                    getGeometry(parsed.id).catch(() => undefined),
                    getWindowState(parsed.id).catch(() => ({
                        minimized: false,
                        maximized: false,
                    })),
                ]);

                return {
                    id: parsed.id,
                    title: parsed.title,
                    wm_class: parsed.wmClass,
                    workspace: parsed.workspace,
                    minimized: state.minimized,
                    maximized: state.maximized,
                    focused: activeId === canonicalWindowId(parsed.id),
                    ...(geometry ?? {}),
                };
            })
    );

    return `Windows (X11 fallback):\n${JSON.stringify(
        windows.filter(Boolean),
        null,
        2
    )}`;
}

async function focusWindow(windowId: string): Promise<string> {
    await run("wmctrl", ["-ia", windowId]);
    return `Window ${windowId} focused`;
}

async function closeWindow(windowId: string): Promise<string> {
    await run("wmctrl", ["-ic", windowId]);
    return `Window ${windowId} closed`;
}

async function minimizeWindow(windowId: string): Promise<string> {
    await run("xdotool", ["windowminimize", decimalWindowId(windowId)]);
    return `Window ${windowId} minimized`;
}

async function maximizeWindow(windowId: string): Promise<string> {
    await run("wmctrl", [
        "-ir",
        windowId,
        "-b",
        "toggle,maximized_vert,maximized_horz",
    ]);
    return `Window ${windowId} maximized toggled`;
}

async function switchWorkspace(workspace: number): Promise<string> {
    await run("wmctrl", ["-s", String(workspace)]);
    return `Switched to workspace ${workspace}`;
}

async function moveToWorkspace(
    windowId: string,
    workspace: number
): Promise<string> {
    await run("wmctrl", ["-ir", windowId, "-t", String(workspace)]);
    return `Window ${windowId} moved to workspace ${workspace}`;
}

async function getGeometryMessage(windowId: string): Promise<string> {
    const geometry = await getGeometry(windowId);
    return `Window ${windowId} geometry: ${JSON.stringify(geometry)}`;
}

async function setGeometry(
    windowId: string,
    geometry: Geometry
): Promise<string> {
    await unmaximize(windowId);
    await applyGeometry(windowId, geometry);
    return `Window ${windowId} geometry set to ${JSON.stringify(geometry)}`;
}

async function setPosition(
    windowId: string,
    x: number,
    y: number
): Promise<string> {
    const current = await getGeometry(windowId);
    return setGeometry(windowId, { ...current, x, y });
}

async function setSize(
    windowId: string,
    width: number,
    height: number
): Promise<string> {
    const current = await getGeometry(windowId);
    return setGeometry(windowId, { ...current, width, height });
}

async function snapWindow(
    windowId: string,
    position: "left" | "right"
): Promise<string> {
    const workArea = await getWorkArea();
    const halfWidth = Math.floor(workArea.width / 2);
    const geometry = {
        x: position === "left" ? workArea.x : workArea.x + halfWidth,
        y: workArea.y,
        width: position === "left" ? halfWidth : workArea.width - halfWidth,
        height: workArea.height,
    };

    await setGeometry(windowId, geometry);
    return `Window ${windowId} snapped ${position}`;
}

async function getGeometry(windowId: string): Promise<Geometry> {
    const out = await run("xwininfo", ["-id", windowId]);
    return {
        x: requireMatchNumber(out, /Absolute upper-left X:\s*(-?\d+)/, "x"),
        y: requireMatchNumber(out, /Absolute upper-left Y:\s*(-?\d+)/, "y"),
        width: requireMatchNumber(out, /Width:\s*(\d+)/, "width"),
        height: requireMatchNumber(out, /Height:\s*(\d+)/, "height"),
    };
}

async function getWindowState(windowId: string): Promise<WindowState> {
    const out = await run("xprop", ["-id", windowId, "WM_STATE", "_NET_WM_STATE"]);
    return {
        minimized: /window state:\s*Iconic/i.test(out),
        maximized:
            /_NET_WM_STATE_MAXIMIZED_HORZ/i.test(out) &&
            /_NET_WM_STATE_MAXIMIZED_VERT/i.test(out),
    };
}

async function getActiveWindowId(): Promise<string | undefined> {
    const out = await run("xprop", ["-root", "_NET_ACTIVE_WINDOW"]);
    const match = out.match(/window id #\s*(0x[0-9a-f]+)/i);
    return match ? canonicalWindowId(match[1]) : undefined;
}

async function getWorkArea(): Promise<Geometry> {
    try {
        const out = await run("xprop", [
            "-root",
            "_NET_WORKAREA",
            "_NET_CURRENT_DESKTOP",
        ]);
        const currentDesktop = requireMatchNumber(
            out,
            /_NET_CURRENT_DESKTOP\(CARDINAL\)\s*=\s*(\d+)/,
            "current desktop"
        );
        const workAreaMatch = out.match(/_NET_WORKAREA\(CARDINAL\)\s*=\s*([^\n]+)/);
        if (!workAreaMatch) throw new Error("_NET_WORKAREA not found");

        const values = workAreaMatch[1]
            .split(",")
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isFinite(value));
        const offset = currentDesktop * 4;
        if (values.length < offset + 4) throw new Error("_NET_WORKAREA is incomplete");

        return {
            x: values[offset],
            y: values[offset + 1],
            width: values[offset + 2],
            height: values[offset + 3],
        };
    } catch {
        const out = await run("xdpyinfo", []);
        const match = out.match(/dimensions:\s*(\d+)x(\d+)/);
        if (!match) throw new Error("Unable to determine screen dimensions");
        return { x: 0, y: 0, width: Number(match[1]), height: Number(match[2]) };
    }
}

async function unmaximize(windowId: string): Promise<void> {
    await run("wmctrl", [
        "-ir",
        windowId,
        "-b",
        "remove,maximized_vert,maximized_horz",
    ]);
}

async function applyGeometry(
    windowId: string,
    geometry: Geometry
): Promise<void> {
    await run("wmctrl", [
        "-ir",
        windowId,
        "-e",
        `0,${geometry.x},${geometry.y},${geometry.width},${geometry.height}`,
    ]);
}

function parseWmctrlLine(line: string):
    | {
          id: string;
          workspace: number;
          wmClass: string;
          title: string;
      }
    | undefined {
    const match = line.match(/^(\S+)\s+(-?\d+)\s+\S+\s+(\S+)\s*(.*)$/);
    if (!match) return undefined;

    return {
        id: normalizeWindowId(match[1]),
        workspace: Number(match[2]),
        wmClass: match[3],
        title: match[4] || "(untitled)",
    };
}

function requireWindowId(args: WindowManagementArgs): string {
    if (!args.window_id) throw new Error("window_id is required for this action");
    return normalizeWindowId(args.window_id);
}

function requireNumber(value: number | undefined, name: string): number {
    if (value === undefined) throw new Error(`${name} is required for this action`);
    return value;
}

function requirePosition(value: string | undefined): "left" | "right" {
    if (value !== "left" && value !== "right") {
        throw new Error("position must be 'left' or 'right'");
    }
    return value;
}

function requireMatchNumber(source: string, pattern: RegExp, name: string): number {
    const match = source.match(pattern);
    if (!match) throw new Error(`Unable to parse ${name}`);
    return Number(match[1]);
}

function normalizeWindowId(windowId: string): string {
    const trimmed = windowId.trim();
    if (/^0x[0-9a-f]+$/i.test(trimmed)) return `0x${trimmed.slice(2).toLowerCase()}`;
    if (/^\d+$/.test(trimmed)) return `0x${Number(trimmed).toString(16)}`;
    return trimmed;
}

function canonicalWindowId(windowId: string): string {
    const normalized = normalizeWindowId(windowId);
    if (!/^0x[0-9a-f]+$/i.test(normalized)) return normalized;
    return `0x${normalized.slice(2).replace(/^0+/, "") || "0"}`.toLowerCase();
}

function decimalWindowId(windowId: string): string {
    const normalized = normalizeWindowId(windowId);
    if (/^0x[0-9a-f]+$/i.test(normalized)) return String(parseInt(normalized, 16));
    return normalized;
}

function run(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            command,
            args,
            {
                encoding: "utf8",
                env: {
                    ...process.env,
                    DISPLAY: getX11Display(),
                },
                maxBuffer: 1024 * 1024,
                timeout: COMMAND_TIMEOUT_MS,
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(formatCommandError(command, args, error, stderr)));
                    return;
                }
                resolve(stdout);
            }
        );
    });
}

function getX11Display(): string | undefined {
    return process.env.AGENT_X11_DISPLAY ?? process.env.DISPLAY ?? ":99";
}

function formatCommandError(
    command: string,
    args: string[],
    error: Error,
    stderr: string
): string {
    const details = stderr.trim() || error.message;
    const hint = /ENOENT|not found/i.test(error.message)
        ? " Install wmctrl, xdotool, and x11-utils on the host."
        : "";
    return `Command failed: ${command} ${args.join(" ")}. ${details}${hint}`;
}

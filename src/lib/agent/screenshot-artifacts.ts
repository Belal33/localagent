import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { getWorkspaceRoot } from "@/lib/workspace-root";

export const WORKSPACE_ROOT = getWorkspaceRoot();
export const SCREENSHOT_ARTIFACT_DIR = resolve(join(WORKSPACE_ROOT, "screenshots"));

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export interface ScreenshotArtifact {
    name: string;
    path: string;
    url: string;
}

export function screenshotArtifactUrl(name: string): string {
    return `/api/screenshots/${encodeURIComponent(name)}`;
}

export function screenshotArtifactName(path: string): string {
    return resolve(path);
}

export async function saveScreenshotArtifact(
    buffer: Uint8Array,
    source = "screenshot"
): Promise<ScreenshotArtifact> {
    await mkdir(SCREENSHOT_ARTIFACT_DIR, { recursive: true });

    const prefix = source
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "screenshot";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${prefix}-${stamp}-${randomUUID().slice(0, 8)}.png`;
    const path = join(SCREENSHOT_ARTIFACT_DIR, name);

    await writeFile(path, buffer);
    return { name, path, url: screenshotArtifactUrl(name) };
}

export function resolveScreenshotArtifact(name: string): { path: string; mimeType: string } | null {
    const decoded = decodePath(name);
    if (!decoded) return null;

    const path = decoded.startsWith("/")
        ? resolve(decoded)
        : resolve(join(SCREENSHOT_ARTIFACT_DIR, basename(decoded)));

    const mimeType = mimeTypeForImage(path);
    if (!mimeType) return null;

    if (!isAllowedScreenshotPath(path)) return null;

    return { path, mimeType };
}

export function extractWorkspaceScreenshotName(text: string): string | null {
    const path = extractWorkspaceScreenshotPath(text);
    return path ? screenshotArtifactName(path) : null;
}

export function extractWorkspaceScreenshotPath(text: string): string | null {
    return extractImagePaths(text).map((candidate) => resolve(candidate)).find(isAllowedScreenshotPath) ?? null;
}

export function mimeTypeForImage(path: string): string | null {
    const lower = path.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    return null;
}

function extractImagePaths(text: string): string[] {
    const matches = [...text.matchAll(/(?:file:\/\/)?(\/[^\r\n]*?\.(?:png|jpe?g|webp))/gi)];
    return matches
        .map((match) => decodePath(match[1]))
        .filter((path): path is string => !!path && IMAGE_EXTENSIONS.has(extensionFor(path)));
}

function decodePath(path: string): string | null {
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
}

function extensionFor(path: string): string {
    const match = path.toLowerCase().match(/\.(png|jpe?g|webp)$/);
    return match ? `.${match[1] === "jpg" ? "jpg" : match[1]}` : "";
}

function isAllowedScreenshotPath(path: string): boolean {
    const allowedRoots = [
        SCREENSHOT_ARTIFACT_DIR,
        resolve(`${process.env.HOME ?? ""}/Pictures`),
        resolve(`${process.env.HOME ?? ""}/Pictures/Screenshots`),
        ...(process.env.HOST_PICTURES_DIR ? [resolve(process.env.HOST_PICTURES_DIR)] : []),
    ].filter((root) => root !== "/");

    return allowedRoots.some((root) => path === root || path.startsWith(`${root}/`));
}

import { existsSync } from "node:fs";

export function isRunningInDocker(): boolean {
    return process.env.AGENT_RUNNING_IN_DOCKER === "true" || existsSync("/.dockerenv");
}

export function localizeHostServiceUrl(url: string): string {
    if (isRunningInDocker()) return url;
    return url.replaceAll("host.docker.internal", "localhost");
}

export function localizeDockerServiceUri(uri: string): string {
    if (isRunningInDocker()) return uri;

    return uri
        .replace("@postgres:", "@localhost:")
        .replace("//postgres:", "//localhost:")
        .replace("bolt://neo4j:", "bolt://localhost:")
        .replaceAll("host.docker.internal", "localhost");
}

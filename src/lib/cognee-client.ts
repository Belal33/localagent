import { localizeHostServiceUrl } from "@/lib/local-runtime";

export const COGNEE_BASE_URL = localizeHostServiceUrl(
    process.env.COGNEE_URL ?? "http://host.docker.internal:8001",
);

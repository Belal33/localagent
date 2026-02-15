import { Skill } from "../index";
import { readFileTools } from "./read-file";
import { writeFileTools } from "./write-file";
import { listDirectoryTools } from "./list-directory";
import { deleteFileTools } from "./delete-file";
import { downloadTools } from "./download";

// ─── Filesystem Skill ───────────────────────────────────────────────────────

export const filesystemSkill: Skill = {
    name: "filesystem",
    description:
        "File system operations: read, write, list, delete files, and download files from URLs.",
    tools: [
        ...readFileTools,
        ...writeFileTools,
        ...listDirectoryTools,
        ...deleteFileTools,
        ...downloadTools,
    ],
    alwaysActive: false,
};

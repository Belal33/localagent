import { test, expect, type Page, type Route } from "@playwright/test";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Creates a mock NDJSON stream body from an array of event objects.
 * Each event is JSON-serialized and separated by newlines.
 */
function makeNDJSON(events: Record<string, unknown>[]): string {
    return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/**
 * Mocks the /api/chat endpoint to return a controlled NDJSON stream.
 * Returns the route handler so it can be awaited.
 */
async function mockChatAPI(page: Page, events: Record<string, unknown>[]) {
    await page.route("**/api/chat", async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/x-ndjson; charset=utf-8",
            body: makeNDJSON(events),
        });
    });
}

/**
 * Sends a message in the chat UI.
 */
async function sendMessage(page: Page, message: string) {
    const input = page.getByPlaceholder("Initialize command sequence...");
    await input.fill(message);
    await page.getByRole("button", { name: /Send/i }).click();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe("Chat Message Flow (Mocked API)", () => {
    test("user message appears in chat", async ({ page }) => {
        await mockChatAPI(page, [
            { type: "token", content: "Hello! How can I help?" },
            { type: "done" },
        ]);
        await page.goto("/");

        await sendMessage(page, "Hi there");

        // User message should appear
        await expect(page.getByText("Hi there")).toBeVisible();
    });

    test("assistant response streams and displays", async ({ page }) => {
        await mockChatAPI(page, [
            { type: "token", content: "I'm your AI assistant." },
            { type: "done" },
        ]);
        await page.goto("/");

        await sendMessage(page, "Who are you?");

        // Wait for assistant response
        await expect(page.getByText("I'm your AI assistant.")).toBeVisible({
            timeout: 10_000,
        });
    });

    test("error event displays error message", async ({ page }) => {
        await mockChatAPI(page, [
            { type: "error", message: "Model overloaded" },
            { type: "done" },
        ]);
        await page.goto("/");

        await sendMessage(page, "test");

        await expect(page.getByText(/Error: Model overloaded/)).toBeVisible({
            timeout: 10_000,
        });
    });

    test("HTTP error shows connection failure", async ({ page }) => {
        await page.route("**/api/chat", async (route: Route) => {
            await route.fulfill({ status: 500, body: "Internal Server Error" });
        });
        await page.goto("/");

        await sendMessage(page, "test");

        await expect(page.getByText(/Failed to connect/)).toBeVisible({
            timeout: 10_000,
        });
    });
});

test.describe("Plan Display (Mocked API)", () => {
    test("plan steps render and update status", async ({ page }) => {
        await mockChatAPI(page, [
            {
                type: "plan",
                steps: ["Research the topic", "Write the code", "Test everything"],
            },
            { type: "step_status", step: "Research the topic", status: "running" },
            { type: "step_status", step: "Research the topic", status: "done" },
            { type: "step_status", step: "Write the code", status: "running" },
            { type: "token", content: "Working on it..." },
            { type: "done" },
        ]);
        await page.goto("/");

        await sendMessage(page, "Do a complex task");

        // Plan header should appear with step count
        const planHeader = page.getByText(/Plan \(/);
        await expect(planHeader).toBeVisible({ timeout: 10_000 });

        // Click to expand
        await planHeader.click();

        // Wait for expand animation (the component uses max-h transition)
        await page.waitForTimeout(500);

        // Steps should be visible (they contain step number prefix like "1. Research the topic")
        await expect(page.getByText(/Research the topic/).first()).toBeVisible({ timeout: 5_000 });
        await expect(page.getByText(/Write the code/).first()).toBeVisible({ timeout: 5_000 });
        await expect(page.getByText(/Test everything/).first()).toBeVisible({ timeout: 5_000 });
    });
});

test.describe("Activity Log (Mocked API)", () => {
    test("tool calls and results appear in activity log", async ({ page }) => {
        await mockChatAPI(page, [
            {
                type: "tool_call",
                tool: "run_terminal",
                args: { command: "ls -la" },
                id: "tc_1",
            },
            {
                type: "tool_result",
                tool: "run_terminal",
                output: "total 48\ndrwxr-xr-x 5 user user 4096 ...",
                id: "tc_1",
            },
            { type: "token", content: "Here are the files." },
            { type: "done" },
        ]);
        await page.goto("/");

        await sendMessage(page, "List files");

        // Activity log should appear — look for the tool name
        await expect(page.getByText("run_terminal").first()).toBeVisible({
            timeout: 10_000,
        });
    });

    test("node transitions appear in activity log", async ({ page }) => {
        await mockChatAPI(page, [
            { type: "node_start", node: "classifier" },
            { type: "node_start", node: "agent" },
            { type: "token", content: "Done." },
            { type: "done" },
        ]);
        await page.goto("/");

        await sendMessage(page, "Simple task");

        // The ActivityLog header includes the latest node label in its summary
        // Verify the Activity header is rendered (always present when items exist)
        await expect(
            page.getByRole("button", { name: /Activity/i })
        ).toBeVisible({ timeout: 10_000 });
    });
});

test.describe("HITL Approval Card (Mocked API)", () => {
    test("interrupt event shows approval card", async ({ page }) => {
        await mockChatAPI(page, [
            {
                type: "interrupt",
                data: {
                    type: "human_review",
                    flaggedCalls: [
                        {
                            index: 0,
                            toolName: "run_terminal",
                            reason: "Destructive operation",
                            args: { command: "rm -rf /tmp/old" },
                        },
                    ],
                    message: "This tool call requires approval before execution.",
                },
            },
        ]);
        await page.goto("/");

        await sendMessage(page, "Delete old files");

        // Approval card should appear
        await expect(
            page.getByText("This tool call requires approval before execution.")
        ).toBeVisible({ timeout: 10_000 });

        // Tool name should be shown
        await expect(page.getByText("run_terminal")).toBeVisible();

        // Input should be disabled during interrupt
        const input = page.getByPlaceholder("Initialize command sequence...");
        await expect(input).toBeDisabled();
    });

    test("approve button sends correct resume request", async ({ page }) => {
        // First mock: initial chat with interrupt
        await mockChatAPI(page, [
            {
                type: "interrupt",
                data: {
                    type: "human_review",
                    flaggedCalls: [
                        {
                            index: 0,
                            toolName: "run_terminal",
                            reason: "Requires review",
                            args: { command: "echo hello" },
                        },
                    ],
                    message: "Approve this action?",
                },
            },
        ]);

        // Track requests to /api/chat/resume
        const resumeRequests: { body: string }[] = [];
        await page.route("**/api/chat/resume", async (route: Route) => {
            const body = route.request().postData() || "";
            resumeRequests.push({ body });
            await route.fulfill({
                status: 200,
                contentType: "application/x-ndjson; charset=utf-8",
                body: makeNDJSON([
                    { type: "token", content: "Action approved and executed." },
                    { type: "done" },
                ]),
            });
        });

        await page.goto("/");
        await sendMessage(page, "Do something");

        // Wait for approval card
        await expect(page.getByText("Approve this action?")).toBeVisible({
            timeout: 10_000,
        });

        // Click approve button
        await page.getByRole("button", { name: /approve/i }).click();

        // Verify resume was called
        await expect(async () => {
            expect(resumeRequests.length).toBeGreaterThan(0);
        }).toPass({ timeout: 5_000 });

        // Verify body contains approve action
        const parsed = JSON.parse(resumeRequests[0].body);
        expect(parsed.decision.action).toBe("approve");

        // Verify response from resume appears
        await expect(
            page.getByText("Action approved and executed.")
        ).toBeVisible({ timeout: 10_000 });
    });

    test("reject button sends correct resume request", async ({ page }) => {
        await mockChatAPI(page, [
            {
                type: "interrupt",
                data: {
                    type: "human_review",
                    flaggedCalls: [
                        {
                            index: 0,
                            toolName: "run_terminal",
                            reason: "Dangerous",
                            args: { command: "rm -rf /" },
                        },
                    ],
                    message: "This looks dangerous. Approve?",
                },
            },
        ]);

        const resumeRequests: { body: string }[] = [];
        await page.route("**/api/chat/resume", async (route: Route) => {
            const body = route.request().postData() || "";
            resumeRequests.push({ body });
            await route.fulfill({
                status: 200,
                contentType: "application/x-ndjson; charset=utf-8",
                body: makeNDJSON([
                    { type: "token", content: "Action rejected." },
                    { type: "done" },
                ]),
            });
        });

        await page.goto("/");
        await sendMessage(page, "Do dangerous thing");

        await expect(page.getByText("This looks dangerous")).toBeVisible({
            timeout: 10_000,
        });

        // Click Reject button — this opens a reject reason input first
        await page.getByRole("button", { name: /^Reject$/i }).click();

        // The reject reason input should appear
        await expect(
            page.getByPlaceholder(/Why reject/i)
        ).toBeVisible({ timeout: 3_000 });

        // Click the confirm reject button ("Confirm Reject")
        await page.getByRole("button", { name: /Confirm.*Reject|Reject$/i }).click();

        await expect(async () => {
            expect(resumeRequests.length).toBeGreaterThan(0);
        }).toPass({ timeout: 5_000 });

        const parsed = JSON.parse(resumeRequests[0].body);
        expect(parsed.decision.action).toBe("reject");
    });
});

test.describe("Multi-turn Conversation (Mocked API)", () => {
    test("multiple messages accumulate in chat", async ({ page }) => {
        let callCount = 0;
        await page.route("**/api/chat", async (route: Route) => {
            callCount++;
            const responses: Record<number, string> = {
                1: "First response.",
                2: "Second response.",
                3: "Third response.",
            };
            await route.fulfill({
                status: 200,
                contentType: "application/x-ndjson; charset=utf-8",
                body: makeNDJSON([
                    { type: "token", content: responses[callCount] || "Default." },
                    { type: "done" },
                ]),
            });
        });

        await page.goto("/");

        // Send first message
        await sendMessage(page, "Message 1");
        await expect(page.getByText("First response.")).toBeVisible({
            timeout: 10_000,
        });

        // Send second message
        await sendMessage(page, "Message 2");
        await expect(page.getByText("Second response.")).toBeVisible({
            timeout: 10_000,
        });

        // All messages should be visible
        await expect(page.getByText("Message 1")).toBeVisible();
        await expect(page.getByText("Message 2")).toBeVisible();
        await expect(page.getByText("First response.")).toBeVisible();
        await expect(page.getByText("Second response.")).toBeVisible();
    });
});

test.describe("Request Payload Verification", () => {
    test("sends correct message format to API", async ({ page }) => {
        const capturedRequests: { body: string }[] = [];

        await page.route("**/api/chat", async (route: Route) => {
            capturedRequests.push({ body: route.request().postData() || "" });
            await route.fulfill({
                status: 200,
                contentType: "application/x-ndjson; charset=utf-8",
                body: makeNDJSON([
                    { type: "token", content: "OK" },
                    { type: "done" },
                ]),
            });
        });

        await page.goto("/");
        await sendMessage(page, "Hello world");

        await expect(async () => {
            expect(capturedRequests.length).toBeGreaterThan(0);
        }).toPass({ timeout: 5_000 });

        const payload = JSON.parse(capturedRequests[0].body);

        // Should have messages array
        expect(Array.isArray(payload.messages)).toBe(true);

        // Last message should be the user's message
        const lastMsg = payload.messages[payload.messages.length - 1];
        expect(lastMsg.role).toBe("user");
        expect(lastMsg.content).toBe("Hello world");

        // Should include threadId
        expect(payload.threadId).toBeTruthy();
        expect(payload.threadId).toMatch(/^thread_\d+_[a-z0-9]+$/);
    });
});

test.describe("Loading State", () => {
    test("shows loading indicator while waiting for response", async ({
        page,
    }) => {
        // Use a delayed response to observe loading state
        await page.route("**/api/chat", async (route: Route) => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await route.fulfill({
                status: 200,
                contentType: "application/x-ndjson; charset=utf-8",
                body: makeNDJSON([
                    { type: "token", content: "Done!" },
                    { type: "done" },
                ]),
            });
        });

        await page.goto("/");
        await sendMessage(page, "Slow task");

        // Loading indicator should appear
        await expect(page.getByText("Computing response...")).toBeVisible({
            timeout: 5_000,
        });

        // Input should be disabled during loading
        const input = page.getByPlaceholder("Initialize command sequence...");
        await expect(input).toBeDisabled();

        // Wait for response to complete
        await expect(page.getByText("Done!")).toBeVisible({ timeout: 10_000 });

        // Loading should disappear
        await expect(page.getByText("Computing response...")).not.toBeVisible();

        // Input should be re-enabled
        await expect(input).toBeEnabled();
    });
});

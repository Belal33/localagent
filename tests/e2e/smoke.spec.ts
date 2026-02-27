import { test, expect } from "@playwright/test";

test.describe("Smoke Tests", () => {
    test("page loads with correct title and header", async ({ page }) => {
        await page.goto("/");

        // Header should be visible
        await expect(
            page.getByRole("heading", { name: /Local AI Core/i })
        ).toBeVisible();

        // Phase badge should be visible
        await expect(page.getByText("Phase 4")).toBeVisible();

        // Engine subtitle should be visible
        await expect(
            page.getByText(/Engine: LangGraph \+ Cognitive Orchestration/i)
        ).toBeVisible();
    });

    test("initial state shows 'awaiting input' message", async ({ page }) => {
        await page.goto("/");

        await expect(
            page.getByText("System initialized. Awaiting input.")
        ).toBeVisible();
    });

    test("thread ID is generated and displayed", async ({ page }) => {
        await page.goto("/");

        // Thread ID is shown in the initial state
        const threadLabel = page.getByText("Thread:");
        await expect(threadLabel).toBeVisible();

        // Thread ID should follow the pattern thread_<timestamp>_<random>
        const threadCode = page.locator("code").first();
        await expect(threadCode).toHaveText(/^thread_\d+_[a-z0-9]+$/);
    });

    test("input field and send button are present", async ({ page }) => {
        await page.goto("/");

        const input = page.getByPlaceholder("Initialize command sequence...");
        await expect(input).toBeVisible();
        await expect(input).toBeEnabled();

        const sendButton = page.getByRole("button", { name: /Send/i });
        await expect(sendButton).toBeVisible();
        // Send button should be disabled when input is empty
        await expect(sendButton).toBeDisabled();
    });

    test("send button enables when input has text", async ({ page }) => {
        await page.goto("/");

        const input = page.getByPlaceholder("Initialize command sequence...");
        const sendButton = page.getByRole("button", { name: /Send/i });

        await expect(sendButton).toBeDisabled();

        await input.fill("Hello");
        await expect(sendButton).toBeEnabled();

        await input.fill("");
        await expect(sendButton).toBeDisabled();
    });

    test("local inference badge is visible", async ({ page }) => {
        await page.goto("/");

        await expect(page.getByText("Local Inference")).toBeVisible();
    });
});

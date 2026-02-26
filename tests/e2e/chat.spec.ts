import { test, expect } from "@playwright/test";

/**
 * Real Chat Integration Tests
 *
 * These tests hit the actual /api/chat endpoint (no mocking).
 * They require the backend LLM proxy to be running at localhost:8080.
 *
 * Skip these tests in CI or when the LLM backend is unavailable
 * by running: npx playwright test --grep-invert "Real Chat"
 */
test.describe("Real Chat Integration", () => {
    // Increase timeout since real LLM calls can be slow
    test.setTimeout(60_000);

    test("sends a message and receives a streaming response", async ({
        page,
    }) => {
        await page.goto("/");

        // Verify initial state
        await expect(
            page.getByText("System initialized. Awaiting input.")
        ).toBeVisible();

        // Type and send a simple message
        const input = page.getByPlaceholder("Initialize command sequence...");
        await input.fill("Say Hi there!");
        await page.getByRole("button", { name: /Send/i }).click();

        // User message should appear immediately
        await expect(
            page.getByText("Say Hi there!")
        ).toBeVisible();

        // Loading indicator should appear
        await expect(page.getByText("Computing response...")).toBeVisible({
            timeout: 5_000,
        });

        // Wait for an assistant response (any text in the assistant message area)
        // The response comes via NDJSON streaming from the real agent
        const assistantMessage = page.locator(
            'div[class*="emerald-950"] p, div[class*="emerald-950"] .max-w-none'
        );
        await expect(assistantMessage.first()).toBeVisible({ timeout: 45_000 });

        // Loading should eventually disappear
        await expect(page.getByText("Computing response...")).not.toBeVisible({
            timeout: 15_000,
        });
    });

    test("executes a complex workflow generating a plan and steps", async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await page.goto("/");

        const input = page.getByPlaceholder("Initialize command sequence...");
        // Add "complex" keyword to ensure the LLM classifier routes it correctly
        await input.fill("This is a complex task: Create a small bash script that prints hello world, save it to dummy.sh, and execute it using a multi step workflow.");
        await page.getByRole("button", { name: /Send/i }).click();

        // Verify loading state
        await expect(page.getByText("Computing response...")).toBeVisible({
            timeout: 5_000,
        });

        // Wait for plan header (Complex workflow generates a plan)
        const planHeader = page.getByText(/Plan \(/);
        await expect(planHeader).toBeVisible({ timeout: 120_000 });

        // Check for final message
        const assistantMessage = page.locator(
            'div[class*="emerald-950"] p, div[class*="emerald-950"] .max-w-none'
        );
        await expect(assistantMessage.first()).toBeVisible({ timeout: 120_000 });
    });

    test("API endpoint returns NDJSON content type", async ({ page }) => {
        await page.goto("/");

        // Listen for the /api/chat response
        const responsePromise = page.waitForResponse("**/api/chat");

        const input = page.getByPlaceholder("Initialize command sequence...");
        await input.fill("Say OK");
        await page.getByRole("button", { name: /Send/i }).click();

        const response = await responsePromise;

        // Verify content type
        expect(response.headers()["content-type"]).toContain("application/x-ndjson");
        expect(response.status()).toBe(200);
    });
});

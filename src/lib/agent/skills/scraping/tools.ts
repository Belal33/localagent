import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { callScraplingTool } from "./shared";

// ─── Common Schemas ──────────────────────────────────────────────────────────

const outputFormatSchema = z
    .enum(["markdown", "html", "text"])
    .optional()
    .default("markdown")
    .describe(
        "Output format: 'markdown' (default, best for LLMs), 'html' (raw HTML), 'text' (plain text)"
    );

const cssSelectorSchema = z
    .string()
    .optional()
    .describe(
        "Optional CSS selector to extract only a specific element (e.g. 'article', '#content', '.post-body'). " +
        "Use this to reduce tokens by targeting exactly what you need."
    );

const proxySchema = z
    .string()
    .optional()
    .describe("Optional proxy URL (e.g. 'http://user:pass@host:port')");

// ─── Single URL Tools ────────────────────────────────────────────────────────

/**
 * Fast HTTP scraping with browser TLS fingerprint + header impersonation.
 * Best for: simple public pages, static content, REST API HTML responses.
 */
const scrapingGet = new DynamicStructuredTool({
    name: "scraping_get",
    description:
        "Scrape a single URL using fast HTTP requests with browser fingerprint impersonation. " +
        "Best for static/public pages that don't require JavaScript. " +
        "Returns page content as markdown (or html/text). " +
        "Use css_selector to target specific elements and save tokens.",
    schema: z.object({
        url: z.string().url().describe("The URL to scrape"),
        css_selector: cssSelectorSchema,
        output_format: outputFormatSchema,
        proxy: proxySchema,
    }),
    func: async ({ url, css_selector, output_format, proxy }) => {
        return callScraplingTool("get", {
            url,
            ...(css_selector && { css_selector }),
            ...(output_format && { output_format }),
            ...(proxy && { proxy }),
        });
    },
});

/**
 * Dynamic scraping with real Chromium browser. Executes JavaScript.
 * Best for: SPAs, pages that load content dynamically.
 */
const scrapingFetch = new DynamicStructuredTool({
    name: "scraping_fetch",
    description:
        "Scrape a single URL using a real Chromium browser (Playwright). Executes JavaScript and waits for dynamic content to load. " +
        "Best for SPAs, React/Vue pages, and anything that requires JS execution. " +
        "Slower than scraping_get but handles dynamic content. " +
        "Use css_selector to target specific elements and save tokens.",
    schema: z.object({
        url: z.string().url().describe("The URL to scrape"),
        css_selector: cssSelectorSchema,
        output_format: outputFormatSchema,
        proxy: proxySchema,
    }),
    func: async ({ url, css_selector, output_format, proxy }) => {
        return callScraplingTool("fetch", {
            url,
            ...(css_selector && { css_selector }),
            ...(output_format && { output_format }),
            ...(proxy && { proxy }),
        });
    },
});

/**
 * Stealth scraping with anti-bot bypass. Beats Cloudflare Turnstile.
 * Best for: sites with bot protection (Cloudflare, PerimeterX, etc.)
 */
const scrapingStealthyFetch = new DynamicStructuredTool({
    name: "scraping_stealthy_fetch",
    description:
        "Scrape a single URL using a modified Firefox browser with advanced anti-bot stealth capabilities. " +
        "Can bypass Cloudflare Turnstile, Cloudflare Interstitial, and similar bot protection systems. " +
        "Use this when scraping_get or scraping_fetch get blocked. " +
        "Use css_selector to target specific elements and save tokens.",
    schema: z.object({
        url: z.string().url().describe("The URL to scrape"),
        css_selector: cssSelectorSchema,
        output_format: outputFormatSchema,
        proxy: proxySchema,
    }),
    func: async ({ url, css_selector, output_format, proxy }) => {
        return callScraplingTool("stealthy_fetch", {
            url,
            ...(css_selector && { css_selector }),
            ...(output_format && { output_format }),
            ...(proxy && { proxy }),
        });
    },
});

// ─── Bulk / Concurrent URL Tools ─────────────────────────────────────────────

/**
 * Concurrent HTTP scraping of multiple URLs at once.
 */
const scrapingBulkGet = new DynamicStructuredTool({
    name: "scraping_bulk_get",
    description:
        "Scrape multiple URLs concurrently using fast HTTP requests with browser fingerprint impersonation. " +
        "Use when you need to scrape several static/public pages simultaneously. " +
        "Returns results for each URL. Use css_selector to reduce tokens.",
    schema: z.object({
        urls: z
            .array(z.string().url())
            .min(1)
            .describe("List of URLs to scrape concurrently"),
        css_selector: cssSelectorSchema,
        output_format: outputFormatSchema,
        proxy: proxySchema,
    }),
    func: async ({ urls, css_selector, output_format, proxy }) => {
        return callScraplingTool("bulk_get", {
            urls,
            ...(css_selector && { css_selector }),
            ...(output_format && { output_format }),
            ...(proxy && { proxy }),
        });
    },
});

/**
 * Concurrent dynamic scraping of multiple URLs with Chromium.
 */
const scrapingBulkFetch = new DynamicStructuredTool({
    name: "scraping_bulk_fetch",
    description:
        "Scrape multiple URLs concurrently using a real Chromium browser. " +
        "Use when you need to scrape several dynamic/JS-rendered pages simultaneously. " +
        "Returns results for each URL.",
    schema: z.object({
        urls: z
            .array(z.string().url())
            .min(1)
            .describe("List of URLs to scrape concurrently"),
        css_selector: cssSelectorSchema,
        output_format: outputFormatSchema,
        proxy: proxySchema,
    }),
    func: async ({ urls, css_selector, output_format, proxy }) => {
        return callScraplingTool("bulk_fetch", {
            urls,
            ...(css_selector && { css_selector }),
            ...(output_format && { output_format }),
            ...(proxy && { proxy }),
        });
    },
});

/**
 * Concurrent stealth scraping of multiple URLs with anti-bot bypass.
 */
const scrapingBulkStealthyFetch = new DynamicStructuredTool({
    name: "scraping_bulk_stealthy_fetch",
    description:
        "Scrape multiple URLs concurrently using a modified Firefox browser with anti-bot bypass capabilities. " +
        "Use when you need to scrape several bot-protected pages simultaneously. " +
        "Returns results for each URL.",
    schema: z.object({
        urls: z
            .array(z.string().url())
            .min(1)
            .describe("List of URLs to scrape concurrently"),
        css_selector: cssSelectorSchema,
        output_format: outputFormatSchema,
        proxy: proxySchema,
    }),
    func: async ({ urls, css_selector, output_format, proxy }) => {
        return callScraplingTool("bulk_stealthy_fetch", {
            urls,
            ...(css_selector && { css_selector }),
            ...(output_format && { output_format }),
            ...(proxy && { proxy }),
        });
    },
});

// ─── Export ───────────────────────────────────────────────────────────────────

export const scrapingTools = [
    scrapingGet,
    scrapingFetch,
    scrapingStealthyFetch,
    scrapingBulkGet,
    scrapingBulkFetch,
    scrapingBulkStealthyFetch,
];

import { Skill } from "../index";
import { scrapingTools } from "./tools";

// ─── Scrapling Web Scraping Skill ────────────────────────────────────────────

export const scrapingSkill: Skill = {
    name: "scraping",
    description:
        "Advanced web scraping powered by Scrapling. " +
        "Handles everything from fast HTTP scraping to full browser automation. " +
        "Bypasses anti-bot systems including Cloudflare Turnstile. " +
        "Supports concurrent bulk scraping of multiple URLs and smart CSS-selector-based extraction to minimize tokens. " +
        "Use scraping_get for static pages, scraping_fetch for JS-heavy pages, scraping_stealthy_fetch for bot-protected sites.",
    tools: scrapingTools,
    alwaysActive: false,
};

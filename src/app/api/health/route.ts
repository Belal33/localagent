/**
 * GET /api/health
 *
 * Returns JSON with the status and connectivity of all app services:
 *   - PostgreSQL (pgvector)
 *   - Neo4j (knowledge graph)
 *   - Anthropic Proxy (LLM)
 *   - Ollama (embeddings)
 */
import { NextResponse } from "next/server";
import { Pool } from "pg";
import neo4j from "neo4j-driver";

export const dynamic = "force-dynamic";

interface ServiceStatus {
    status: "healthy" | "unhealthy";
    latencyMs?: number;
    error?: string;
    details?: Record<string, unknown>;
}

interface HealthResponse {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    services: {
        postgres: ServiceStatus;
        neo4j: ServiceStatus;
        anthropicProxy: ServiceStatus;
        ollama: ServiceStatus;
    };
}

async function checkPostgres(): Promise<ServiceStatus> {
    const uri =
        process.env.AGENT_PG_URI ??
        "postgresql://agent:agent_local_dev@postgres:5432/agent_memory";
    const pool = new Pool({ connectionString: uri, connectionTimeoutMillis: 5000 });
    const start = Date.now();
    try {
        const result = await pool.query("SELECT 1 AS ok, version() AS version");
        return {
            status: "healthy",
            latencyMs: Date.now() - start,
            details: { version: result.rows[0]?.version },
        };
    } catch (err: any) {
        return { status: "unhealthy", latencyMs: Date.now() - start, error: err.message };
    } finally {
        await pool.end();
    }
}

async function checkNeo4j(): Promise<ServiceStatus> {
    const uri = process.env.AGENT_NEO4J_URI ?? "bolt://neo4j:7687";
    const user = process.env.AGENT_NEO4J_USER ?? "neo4j";
    const pass = process.env.AGENT_NEO4J_PASS ?? "agent_local_dev";
    const driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));
    const start = Date.now();
    try {
        const info = await driver.getServerInfo();
        return {
            status: "healthy",
            latencyMs: Date.now() - start,
            details: { address: info.address, version: info.protocolVersion },
        };
    } catch (err: any) {
        return { status: "unhealthy", latencyMs: Date.now() - start, error: err.message };
    } finally {
        await driver.close();
    }
}

async function checkAnthropicProxy(): Promise<ServiceStatus> {
    const url = process.env.ANTHROPIC_PROXY_URL ?? "http://host.docker.internal:8080";
    const start = Date.now();
    try {
        const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
        return {
            status: "healthy",
            latencyMs: Date.now() - start,
            details: { httpStatus: res.status },
        };
    } catch (err: any) {
        return { status: "unhealthy", latencyMs: Date.now() - start, error: err.message };
    }
}

async function checkOllama(): Promise<ServiceStatus> {
    const url = process.env.AGENT_OLLAMA_URL ?? "http://host.docker.internal:11434";
    const start = Date.now();
    try {
        const res = await fetch(`${url}/api/tags`, { method: "GET", signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        const models = (data.models ?? []).map((m: { name: string }) => m.name);
        return {
            status: "healthy",
            latencyMs: Date.now() - start,
            details: { models },
        };
    } catch (err: any) {
        return { status: "unhealthy", latencyMs: Date.now() - start, error: err.message };
    }
}

export async function GET() {
    const [postgres, neo4jStatus, anthropicProxy, ollama] = await Promise.all([
        checkPostgres(),
        checkNeo4j(),
        checkAnthropicProxy(),
        checkOllama(),
    ]);

    const services = { postgres, neo4j: neo4jStatus, anthropicProxy, ollama };
    const allHealthy = Object.values(services).every((s) => s.status === "healthy");
    const allUnhealthy = Object.values(services).every((s) => s.status === "unhealthy");

    const response: HealthResponse = {
        status: allHealthy ? "healthy" : allUnhealthy ? "unhealthy" : "degraded",
        timestamp: new Date().toISOString(),
        services,
    };

    return NextResponse.json(response, {
        status: allHealthy ? 200 : 503,
    });
}

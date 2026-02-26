import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

/**
 * ─── Phase 3: Extended Agent State ──────────────────────────────────────────
 *
 * Extends MessagesAnnotation with planning state for the Plan-and-Execute
 * cognitive architecture. Used by the planner, executor, and replan nodes.
 */

export const AgentAnnotation = Annotation.Root({
    // Inherit all message handling from MessagesAnnotation
    ...MessagesAnnotation.spec,

    // ─── Planning State ──────────────────────────────────────
    /** Ordered list of remaining steps in the current plan */
    plan: Annotation<string[]>({
        reducer: (_, next) => next, // Replace on update
        default: () => [],
    }),

    /** History of completed steps: [stepDescription, result] tuples */
    pastSteps: Annotation<[string, string][]>({
        reducer: (prev, next) => [...prev, ...next],
        default: () => [],
    }),

    /** The step currently being executed */
    currentStep: Annotation<string>({
        reducer: (_, next) => next,
        default: () => "",
    }),

    /** Final response from the replan node when the task is complete */
    response: Annotation<string>({
        reducer: (_, next) => next,
        default: () => "",
    }),

    /** Skills activated during this session (by agent calling the placeholder tool) */
    activeSkills: Annotation<string[]>({
        reducer: (prev, next) => [...new Set([...prev, ...next])],
        default: () => [],
    }),

    // ─── Step Execution Tracking ────────────────────────────
    /** Outcome of the last executed step: "success", "failed", or "" (not yet evaluated) */
    stepStatus: Annotation<"success" | "failed" | "">({
        reducer: (_, next) => next,
        default: () => "",
    }),

    /** Number of retry attempts for the current step (max 2 before giving up) */
    stepRetries: Annotation<number>({
        reducer: (_, next) => next,
        default: () => 0,
    }),
});

export type AgentState = typeof AgentAnnotation.State;

/**
 * The openai adapter's contract tests — `P3-T30`, `docs/13` §2.2 layer 2,
 * over `test/fixtures/llm/openai/`. The suite is `./_llmContract.ts`'s,
 * shared by the four providers; read its header for what runs today and
 * what waits for the owner's recording (`docs/13` §3.4). No network.
 */

import { defineLlmContractSuite } from "./_llmContract";

defineLlmContractSuite("openai");

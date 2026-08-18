import { describe, expect, it } from "vite-plus/test";
import { buildContextPrompt } from "@/features/ai/utils/ai-context-builder";

describe("AI context builder external paths", () => {
  it("labels outside-workspace selected paths as external context", () => {
    const prompt = buildContextPrompt({
      projectRoot: "/Users/me/current-project",
      selectedProjectFiles: [
        "/Users/me/current-project/src/app.ts",
        "/Users/me/other-project/README.md",
        "/Users/me/shared/docs",
      ],
      agentId: "custom",
    });

    expect(prompt).toContain("Selected workspace context files: app.ts");
    expect(prompt).toContain("Selected external context (outside current workspace):");
    expect(prompt).toContain("- /Users/me/other-project/README.md");
    expect(prompt).toContain("- /Users/me/shared/docs");
  });
});

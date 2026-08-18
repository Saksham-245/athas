import type { AIChatSkill } from "@/features/ai/types/skills.types";
import type { AgentHttpTool } from "./tool-types";

const MAX_SKILL_TOOLS = 32;

function slugifySkillId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function skillToolName(skill: AIChatSkill): string {
  const slug = slugifySkillId(skill.title || skill.id) || "skill";
  return `skill_${slug}`.slice(0, 64);
}

export function createSkillAgentHttpTools(skills: AIChatSkill[]): AgentHttpTool[] {
  const seen = new Set<string>();
  const tools: AgentHttpTool[] = [];

  for (const skill of skills) {
    if (!skill.content?.trim()) continue;
    if (tools.length >= MAX_SKILL_TOOLS) break;

    let name = skillToolName(skill);
    if (seen.has(name)) {
      name = `${name}_${tools.length + 1}`.slice(0, 64);
    }
    seen.add(name);

    tools.push({
      name,
      description:
        skill.description?.trim() ||
        `Activate the "${skill.title}" skill and inject its instructions into this turn.`,
      kind: "think",
      permission: "none",
      modes: ["chat", "plan", "agent", "all"],
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Optional short reason for activating this skill",
          },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        return {
          ok: true,
          output: {
            skill_id: skill.id,
            skill_title: skill.title,
            activated: true,
            reason: reason || null,
            instructions: skill.content,
            guidance:
              "Follow the skill instructions above for the rest of this turn. Use other tools if needed.",
          },
        };
      },
    });
  }

  return tools;
}

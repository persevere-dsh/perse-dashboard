/** Resource boundary guard. Unknown fields survive; malformed known fields never reach rendering. */
import { z } from 'zod'
import type { DashboardSnapshot } from '../contract/types.ts'
const result = z.object({
  criterion: z.number().int().nonnegative(),
  passed: z.boolean(),
  evidence: z.string(),
})
const schema = z.object({
  revision: z.number().int().nonnegative(),
  ledger: z.array(
    z.object({
      seq: z.number(),
      taskId: z.string(),
      action: z.string(),
      actor: z.string(),
      time: z.number(),
    }),
  ),
  dispatch: z.object({ enabled: z.boolean(), error: z.string().nullable() }),
  capabilities: z.record(z.string(), z.boolean()).optional(),
  imageLimits: z
    .object({
      maxImages: z.number().int().min(1).max(4),
      maxImageBytes: z.number().int().positive(),
      maxImagePixels: z.number().int().positive(),
      maxImageDimension: z.number().int().positive(),
      mediaTypes: z.array(
        z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
      ),
    })
    .optional(),
  tasks: z.array(
    z
      .object({
        id: z.string(),
        workspaceId: z.string(),
        title: z.string(),
        description: z.string(),
        criteria: z.array(z.string()),
        checked: z.array(z.boolean()),
        evidence: z.string(),
        images: z
          .array(
            z.object({
              path: z.string(),
              caption: z.string(),
              criterion: z.number().int().nonnegative().optional(),
            }),
          )
          .max(12)
          .optional(),
        inputImages: z
          .array(
            z.object({
              attachmentId: z.string(),
              mediaType: z.enum([
                'image/png',
                'image/jpeg',
                'image/webp',
                'image/gif',
              ]),
              bytes: z.number().int().positive(),
              width: z.number().int().positive(),
              height: z.number().int().positive(),
              name: z.string(),
              source: z.enum(['description', 'criteria']),
            }),
          )
          .max(4)
          .optional(),
        language: z.enum(['zh', 'en']).nullable().optional(),
        priority: z.number().int().min(0).max(2),
        assignee: z.string().nullable(),
        sessionId: z.string().nullable(),
        status: z.enum([
          'triage',
          'needs-info',
          'todo',
          'in-progress',
          'blocked',
          'in-review',
          'done',
        ]),
        version: z.number().int().positive(),
        archived: z.boolean(),
        createdAt: z.number(),
        updatedAt: z.number(),
        analysisSessionId: z.string().nullable().optional(),
        reviewSessionId: z.string().nullable().optional(),
        analysis: z
          .object({
            summary: z.string(),
            plan: z.array(z.string()),
            risk: z.enum(['low', 'medium', 'high']),
            route: z.enum(['express', 'staged', 'needs-info', 'human']),
            questions: z.array(z.string()),
          })
          .nullable()
          .optional(),
        review: z
          .object({
            verdict: z.enum(['pass', 'fail', 'needs-human']),
            risk: z.enum(['low', 'medium', 'high']),
            results: z.array(result),
            remainingRisks: z.array(z.string()),
            evidence: z.string(),
          })
          .nullable()
          .optional(),
        completionPolicy: z
          .object({
            mode: z.enum(['manual', 'verified', 'reviewed']),
            instructions: z.string(),
            checks: z.array(
              z.object({
                criterion: z.number().int().nonnegative(),
                path: z.string(),
                kind: z.enum(['text-equals', 'sha256']),
                expected: z.string(),
              }),
            ),
          })
          .optional(),
        completion: z
          .object({
            kind: z.enum(['human', 'verified', 'reviewed']),
            ruleVersion: z.string(),
            checks: z.array(result).optional(),
          })
          .nullable()
          .optional(),
        automationNote: z.string().optional(),
        needsManual: z.boolean().optional(),
      })
      .refine((t) => t.criteria.length === t.checked.length),
  ),
})
export function validSnapshot(value: unknown): value is DashboardSnapshot {
  return schema.safeParse(value).success
}

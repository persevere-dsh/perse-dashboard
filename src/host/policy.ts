/** Owner rules and mechanical gates. No model can expand its completion authority. */
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import type {
  Task,
  CriterionResult,
  CompletionPolicy,
} from '../contract/types.ts'
export const RULE_VERSION = 'completion/3'
export const manualPolicy = () => ({
  mode: 'manual' as const,
  instructions: '',
  checks: [],
})
export const completionPolicySchema = z.strictObject({
  mode: z.enum(['manual', 'verified', 'reviewed']),
  instructions: z.string().max(12000),
  checks: z
    .array(
      z.strictObject({
        criterion: z.number().int().nonnegative(),
        path: z.string().min(1).max(1000),
        kind: z.enum(['text-equals', 'sha256']),
        expected: z.string().max(100000),
      }),
    )
    .max(20),
})
/**
 * Reject an unsatisfiable owner policy at write time. This is the same rule
 * checkFiles enforces at completion time, moved earlier so a task cannot be
 * created or edited into a state that can never auto-complete.
 */
export function completionPolicyProblem(
  policy: CompletionPolicy,
  criteria: readonly string[],
): string | null {
  if (policy.mode !== 'verified') return null
  const checks = policy.checks
  if (
    !criteria.length ||
    checks.length !== criteria.length ||
    new Set(checks.map((check) => check.criterion)).size !==
      criteria.length ||
    checks.some(
      (check) =>
        !Number.isInteger(check.criterion) ||
        check.criterion < 0 ||
        check.criterion >= criteria.length,
    )
  )
    return 'Verified completion requires exactly one machine check for every criterion'
  return null
}
export const analysisSchema = z.strictObject({
  summary: z.string().trim().min(1).max(6000),
  plan: z.array(z.string().trim().min(1).max(3000)).min(1).max(20),
  risk: z.enum(['low', 'medium', 'high']),
  route: z.enum(['express', 'staged', 'needs-info', 'human']),
  questions: z.array(z.string().trim().min(1).max(1000)).max(20),
})
export const criterionResultSchema = z.strictObject({
  criterion: z.number().int().nonnegative(),
  passed: z.boolean(),
  evidence: z.string().trim().min(1).max(12000),
})
export const reviewSchema = z.strictObject({
  verdict: z.enum(['pass', 'fail', 'needs-human']),
  risk: z.enum(['low', 'medium', 'high']),
  results: z.array(criterionResultSchema).max(20),
  remainingRisks: z.array(z.string().trim().min(1).max(2000)).max(20),
  evidence: z.string().trim().min(1).max(20000),
})
export const receiptSchema = z.object({
  kind: z.enum(['human', 'verified', 'reviewed']),
  time: z.number(),
  ruleVersion: z.string(),
  promptHash: z.string(),
  evidenceHash: z.string(),
  reviewerSessionId: z.string().nullable(),
  checks: z.array(criterionResultSchema).default([]),
  results: z.array(criterionResultSchema),
})
export const digest = (value: unknown) =>
  createHash('sha256')
    .update(
      typeof value === 'string' || value instanceof Uint8Array
        ? value
        : JSON.stringify(value),
    )
    .digest('hex')
export function coversAll(task: Task, results: CriterionResult[]) {
  return (
    results.length === task.criteria.length &&
    new Set(results.map((r) => r.criterion)).size === task.criteria.length &&
    results.every(
      (r) =>
        Number.isInteger(r.criterion) &&
        r.criterion >= 0 &&
        r.criterion < task.criteria.length &&
        r.passed &&
        r.evidence.trim(),
    )
  )
}
export function canAutoComplete(task: Task) {
  return (
    task.completionPolicy.mode !== 'manual' &&
    !task.needsManual &&
    task.analysis?.risk === 'low' &&
    task.analysis.route === 'express' &&
    !!task.evidence.trim() &&
    task.criteria.length > 0
  )
}
/** Read-only, bounded verification; refuses absolute/traversal/escaping symlink paths. */
export async function checkFiles(
  task: Task,
  workspace: string,
): Promise<CriterionResult[]> {
  const checks = task.completionPolicy.checks
  if (
    task.completionPolicy.mode === 'verified' &&
    (checks.length !== task.criteria.length ||
      new Set(checks.map((c) => c.criterion)).size !== task.criteria.length)
  )
    throw Error('A machine check is required for every criterion')
  const root = await realpath(workspace),
    results: CriterionResult[] = []
  for (const check of checks) {
    if (
      check.criterion >= task.criteria.length ||
      path.isAbsolute(check.path) ||
      check.path.split(/[\\/]/).includes('..')
    )
      throw Error(
        'Verification path or criterion is outside the approved scope',
      )
    const target = await realpath(path.join(root, check.path))
    if (!target.startsWith(root + path.sep))
      throw Error('Verification path escapes the workspace')
    const file = await open(target, 'r')
    try {
      const before = await file.stat()
      if (!before.isFile() || before.size > 1024 * 1024)
        throw Error('Verification requires a regular file no larger than 1 MiB')
      const buffer = Buffer.alloc(1024 * 1024 + 1)
      let length = 0
      while (length < buffer.length) {
        const read = await file.read(
          buffer,
          length,
          buffer.length - length,
          null,
        )
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      if (length > 1024 * 1024)
        throw Error('Verification file grew beyond 1 MiB')
      const bytes = buffer.subarray(0, length),
        after = await file.stat()
      if (
        before.mtimeMs !== after.mtimeMs ||
        before.size !== after.size ||
        target !== (await realpath(path.join(root, check.path)))
      )
        throw Error('File changed during verification')
      const actual =
        check.kind === 'text-equals' ? bytes.toString('utf8') : digest(bytes)
      results.push({
        criterion: check.criterion,
        passed: actual === check.expected,
        evidence: `${check.kind}: ${check.path}; ${bytes.length} bytes; sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
      })
    } finally {
      await file.close()
    }
  }
  return results
}

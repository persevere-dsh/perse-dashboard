/** Deterministic task-language resolution shared by Host prompts and Client display. */
import type { TaskLanguage } from './types.ts'
/** English marker the intake form used to append before task language was persisted. */
export const OWNER_EXPECTATIONS_EN = 'Acceptance expectations supplied by owner:'
/** Chinese replacement shown for Chinese tasks without rewriting stored data. */
export const OWNER_EXPECTATIONS_ZH = '所有者补充的验收期望：'
const HAN = /\p{Script=Han}/gu
const LATIN = /[A-Za-z]/g
const count = (text: string, pattern: RegExp) =>
  text.match(pattern)?.length ?? 0
/**
 * Deterministic CJK-ratio inference for tasks persisted before `language`
 * existed. Han and Latin letters are counted; numbers, punctuation, paths and
 * machine tokens do not shift the decision. Empty content falls back to `en`.
 */
export function detectTaskLanguage(input: {
  title?: string
  description?: string
  criteria?: readonly string[]
}): TaskLanguage {
  const clean = (value: string) =>
    value.split(OWNER_EXPECTATIONS_EN).join('\n').trim()
  const judge = (text: string): TaskLanguage | null => {
    const han = count(text, HAN)
    if (!han) return null
    const latin = count(text, LATIN)
    return !latin || han / (han + latin) >= 0.2 ? 'zh' : null
  }
  // Title and description are owner-authored. Generated criteria can be English
  // even on a Chinese task, so they only decide when that owner text has no
  // decisive Chinese share.
  const primary = clean([input.title ?? '', input.description ?? ''].join('\n'))
  const fromPrimary = judge(primary)
  if (fromPrimary) return fromPrimary
  const all = clean(
    [input.title ?? '', input.description ?? '', ...(input.criteria ?? [])].join(
      '\n',
    ),
  )
  return judge(all) ?? 'en'
}
/**
 * Language priority: an explicit persisted task language wins, then content
 * inference, then the `en` fallback for empty content. Never consults the live
 * UI preference, so switching the interface language never rewrites old tasks.
 */
export function resolveTaskLanguage(task: {
  language?: TaskLanguage | null
  title?: string
  description?: string
  criteria?: readonly string[]
}): TaskLanguage {
  return (
    task.language ?? detectTaskLanguage(task)
  )
}
/**
 * Render-time normalization of the legacy English intake marker for Chinese
 * tasks. Display and prompt facts show Chinese immediately while storage stays
 * untouched; the next owner edit persists the normalized description.
 */
export function normalizeDescription(
  description: string,
  language: TaskLanguage,
): string {
  if (language !== 'zh') return description
  return description.split(OWNER_EXPECTATIONS_EN).join(OWNER_EXPECTATIONS_ZH)
}
/**
 * Detect historical generated text that is Latin-dominant while the task is
 * Chinese. Display-only: it never changes stored analysis, evidence or review.
 */
export function looksLatinDominant(text: string): boolean {
  if (typeof text !== 'string') return false
  const han = count(text, HAN)
  const latin = count(text, LATIN)
  return latin >= 20 && han * 4 < latin
}
/** Localized description used for rendering and prompt facts; never mutates the task. */
export function taskDescription(task: {
  language?: TaskLanguage | null
  title?: string
  description: string
  criteria?: readonly string[]
}): string {
  return normalizeDescription(task.description, resolveTaskLanguage(task))
}

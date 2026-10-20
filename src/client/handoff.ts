/** Owner-facing copy for the prepared DSH draft; tool names stay literal. */
import type { TaskLanguage } from '../contract/types.ts'
import { en, zh } from './locales.ts'
export function handoffPrompt(language: TaskLanguage, taskId: string): string {
  return (language === 'zh' ? zh : en).handoffPrompt.replace('{id}', taskId)
}

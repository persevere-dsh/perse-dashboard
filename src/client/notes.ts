/** Localized presentation of Host machine notes; stored tokens stay unchanged. */
import type { Key } from './locales.ts'
type Translate = (key: Key) => string
const HUMAN_ACCEPTANCE = 'human-acceptance-required'
const HUMAN_IMPLEMENTATION = 'Human implementation required'
const MACHINE_FAILED = 'Machine verification failed: '
const VERIFY_UNAVAILABLE = 'Automatic verification unavailable: '
const AGENT_RESUMED =
  'A linked Agent resumed during verification. Completion remains pending.'
/**
 * Render a Host automation note in the active UI language. Notes are Host fact
 * tokens (or token + detail), never evidence text: accepted evidence and
 * completion receipts are not translated or rewritten.
 */
export function automationNoteText(note: string, t: Translate): string {
  if (!note) return ''
  if (
    note === HUMAN_ACCEPTANCE ||
    note.startsWith('Automatic completion held:')
  )
    return t('humanGateNote')
  if (note === HUMAN_IMPLEMENTATION) return t('machineHumanImplementation')
  if (note.startsWith(MACHINE_FAILED))
    return `${t('machineVerificationFailed')}${note.slice(MACHINE_FAILED.length)}`
  if (note.startsWith(VERIFY_UNAVAILABLE))
    return `${t('machineVerificationUnavailable')}${note.slice(VERIFY_UNAVAILABLE.length)}`
  if (note === AGENT_RESUMED) return t('machineAgentResumed')
  if (note === 'phase-report-missing') return t('phaseMissingNote')
  if (note === 'review-failed') return t('reviewFailedNote')
  if (note === 'review-report-missing') return t('reviewMissingNote')
  // Needs-info notes carry model-authored questions; never translate content.
  return note
}

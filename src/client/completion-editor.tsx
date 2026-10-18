import React from 'react'
import type { CompletionPolicy } from '../contract/types.ts'
import type { Injected } from './view.tsx'
import { OptionGroup } from './option-group.tsx'
export function CompletionEditor({
  value,
  change,
  t,
  disabled = false,
}: {
  value: CompletionPolicy
  change: (p: CompletionPolicy) => void
  t: Injected['t']
  disabled?: boolean
}) {
  return (
    <div className="pd-policy">
      <OptionGroup
        label={t('completionMode')}
        disabled={disabled}
        value={value.mode}
        change={(mode) => change({ ...value, mode })}
        options={(['manual', 'verified', 'reviewed'] as const).map((mode) => ({
          value: mode,
          text: t(mode),
        }))}
      />
      <p className="pd-muted">{t('completionHelp')}</p>
      <details className="pd-advanced">
        <summary>{t('advancedRules')}</summary>
        <label className="pd-field">
          {t('completionInstructions')}
          <textarea
            disabled={disabled}
            maxLength={12000}
            value={value.instructions}
            onChange={(e) => change({ ...value, instructions: e.target.value })}
          />
        </label>
        {value.mode !== 'manual' && (
          <>
            <h3>{t('machineChecks')}</h3>
            <p className="pd-muted">{t('checksHelp')}</p>
            {value.checks.map((check, index) => (
              <div key={index} className="pd-rule">
                <label className="pd-field">
                  {t('criterionIndex')}
                  <input
                    type="number"
                    min={1}
                    max={20}
                    disabled={disabled}
                    value={check.criterion + 1}
                    onChange={(e) =>
                      change({
                        ...value,
                        checks: value.checks.map((c, n) =>
                          n === index
                            ? { ...c, criterion: Number(e.target.value) - 1 }
                            : c,
                        ),
                      })
                    }
                  />
                </label>
                <label className="pd-field">
                  {t('filePath')}
                  <input
                    disabled={disabled}
                    value={check.path}
                    onChange={(e) =>
                      change({
                        ...value,
                        checks: value.checks.map((c, n) =>
                          n === index ? { ...c, path: e.target.value } : c,
                        ),
                      })
                    }
                  />
                </label>
                <OptionGroup
                  className="pd-rule-wide"
                  label={t('checkKind')}
                  disabled={disabled}
                  value={check.kind}
                  change={(kind) =>
                    change({
                      ...value,
                      checks: value.checks.map((c, n) =>
                        n === index ? { ...c, kind } : c,
                      ),
                    })
                  }
                  options={[
                    { value: 'text-equals', text: t('textEquals') },
                    { value: 'sha256', text: 'SHA256' },
                  ]}
                />
                <label className="pd-field pd-rule-wide">
                  {t('expectedValue')}
                  <textarea
                    disabled={disabled}
                    value={check.expected}
                    onChange={(e) =>
                      change({
                        ...value,
                        checks: value.checks.map((c, n) =>
                          n === index ? { ...c, expected: e.target.value } : c,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    change({
                      ...value,
                      checks: value.checks.filter((_c, n) => n !== index),
                    })
                  }
                >
                  {t('removeCheck')}
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={disabled || value.checks.length >= 20}
              onClick={() =>
                change({
                  ...value,
                  checks: [
                    ...value.checks,
                    {
                      criterion: value.checks.length,
                      path: '',
                      kind: 'text-equals',
                      expected: '',
                    },
                  ],
                })
              }
            >
              {t('addCheck')}
            </button>
          </>
        )}
      </details>
    </div>
  )
}

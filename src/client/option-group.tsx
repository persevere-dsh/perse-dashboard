/** Single-choice chip group: hidden native radios keep arrow-key navigation. */
import React, { useId } from 'react'
export function OptionGroup<T extends string | number>({
  label,
  options,
  value,
  change,
  disabled = false,
  className = '',
}: {
  label: string
  options: readonly { value: T; text: string; disabled?: boolean }[]
  value: T
  change: (value: T) => void
  disabled?: boolean
  className?: string
}) {
  const name = useId()
  return (
    <div
      className={className ? `pd-field ${className}` : 'pd-field'}
      role="radiogroup"
      aria-label={label}
    >
      <span className="pd-group-name">{label}</span>
      <div className="pd-chips" role="presentation">
        {options.map((option) => (
          <label className="pd-chip" key={String(option.value)}>
            <input
              type="radio"
              name={name}
              disabled={disabled || option.disabled}
              checked={option.value === value}
              onChange={() => change(option.value)}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

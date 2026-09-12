import { useEffect, useId, useRef, useState } from 'react'

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** optional second line inside the option row */
  hint?: string
}

interface Props<T extends string> {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  id?: string
  'aria-labelledby'?: string
}

/**
 * Listbox styled to match the rest of the form - a native <select> renders its
 * popup with OS chrome, which reads as a foreign element on a dark panel.
 *
 * Keyboard contract follows the ARIA combobox pattern: focus stays on the button
 * and the active option is tracked with aria-activedescendant, so screen readers
 * announce the highlighted row without the focus moving into the popup.
 */
export function Select<T extends string>({ value, options, onChange, id, ...aria }: Props<T>) {
  const generatedId = useId()
  const listId = `${id ?? generatedId}-listbox`
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)))
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLLIElement | null)[]>([])

  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const openAt = (index: number) => {
    setActiveIndex(Math.max(0, Math.min(options.length - 1, index)))
    setOpen(true)
  }

  const commit = (index: number) => {
    const option = options[index]
    if (option) onChange(option.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const selectedIndex = options.findIndex((option) => option.value === value)
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) openAt(selectedIndex + 1)
        else setActiveIndex((index) => Math.min(options.length - 1, index + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        if (!open) openAt(selectedIndex - 1)
        else setActiveIndex((index) => Math.max(0, index - 1))
        break
      case 'Home':
        if (open) {
          event.preventDefault()
          setActiveIndex(0)
        }
        break
      case 'End':
        if (open) {
          event.preventDefault()
          setActiveIndex(options.length - 1)
        }
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (open) commit(activeIndex)
        else openAt(selectedIndex)
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          setOpen(false)
        }
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        break
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        aria-labelledby={aria['aria-labelledby']}
        onClick={() => (open ? setOpen(false) : openAt(options.findIndex((option) => option.value === value)))}
        onKeyDown={onKeyDown}
        className="field flex items-center justify-between gap-3 text-left"
      >
        <span className="truncate">{selected?.label}</span>
        <svg
          viewBox="0 0 12 8"
          aria-hidden="true"
          className={`h-2 w-3 shrink-0 fill-none stroke-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 1.5 6 6.5 11 1.5" />
        </svg>
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={aria['aria-labelledby']}
          className="absolute z-30 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl shadow-black/60"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            const isActive = index === activeIndex
            return (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                ref={(node) => {
                  optionRefs.current[index] = node
                }}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
                className={`cursor-pointer rounded-lg px-3 py-2 transition ${
                  isActive ? 'bg-slate-800' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 text-xs ${isSelected ? 'text-indigo-400' : 'text-transparent'}`}
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm ${isSelected ? 'text-slate-100' : 'text-slate-300'}`}>
                      {option.label}
                    </span>
                    {option.hint && <span className="mt-0.5 block text-xs text-slate-500">{option.hint}</span>}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

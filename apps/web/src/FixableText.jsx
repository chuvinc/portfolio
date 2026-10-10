import { useState } from 'react'

const UNSURE = 85 // characters the engine was less sure of than this are underlined

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

// The extracted text, shown character by character so a wrong one can be clicked and turned
// into a glossary entry. `entries` are { ch, conf }; `onAdd(line)` receives the glossary line.
export default function FixableText({ entries, onAdd }) {
  const chars = entries.map((e) => e.ch)
  const signature = chars.join('')

  // Indices into `entries`. Tied to the text it was made on, so it resets when the text changes.
  const [picked, setPicked] = useState(null) // { sig, anchor, start, end }
  const [fix, setFix] = useState('')
  const [context, setContext] = useState(2)
  const [note, setNote] = useState('')
  const sel = picked && picked.sig === signature ? picked : null

  const select = (anchor, start, end) => {
    setPicked({ sig: signature, anchor, start, end })
    setFix(chars.slice(start, end + 1).join(''))
  }

  const pick = (i, shift) => {
    setNote('')
    if (chars[i] === '\n') return
    if (sel && (shift || i === sel.start - 1 || i === sel.end + 1)) {
      // Extending a selection: shift-click anywhere on the line, or click a neighbour.
      const start = Math.min(sel.start, i)
      const end = Math.max(sel.end, i)
      if (!chars.slice(start, end + 1).includes('\n')) select(sel.anchor, start, end)
      return
    }
    if (sel && sel.start === i && sel.end === i) setPicked(null)
    else select(i, i, i)
  }

  // The selection plus a few characters either side (never past a line break), so the entry is
  // specific enough not to rewrite text it shouldn't.
  const around = (from, step) => {
    let out = ''
    for (let i = from; i >= 0 && i < chars.length && out.length < context && chars[i] !== '\n'; i += step) {
      out = step < 0 ? chars[i] + out : out + chars[i]
    }
    return out
  }
  const selected = sel ? chars.slice(sel.start, sel.end + 1).join('') : ''
  const left = sel ? around(sel.start - 1, -1) : ''
  const right = sel ? around(sel.end + 1, 1) : ''
  const wrongText = left + selected + right
  const rightText = left + fix + right
  const changed = sel && fix !== selected

  const add = (line) => {
    onAdd(line)
    setNote(`Added to the glossary: ${line}`)
    setPicked(null)
  }

  return (
    <div className="fixable-wrap">
      <div
        className="fixable"
        role="textbox"
        aria-readonly="true"
        aria-label="Extracted text"
        onClick={(e) => {
          const i = e.target.dataset?.i
          if (i !== undefined) pick(Number(i), e.shiftKey)
        }}
      >
        {entries.map((e, i) =>
          e.ch === '\n' ? (
            <br key={i} />
          ) : (
            <span
              key={i}
              data-i={i}
              className={[
                e.ch.trim() && e.conf < UNSURE ? 'unsure' : '',
                sel && i >= sel.start && i <= sel.end ? 'picked' : '',
              ].join(' ')}
            >
              {e.ch}
            </span>
          ),
        )}
      </div>
      <p className="status">
        Click a wrong character to fix it in your glossary. Click its neighbours (or shift-click) to
        select several. Dotted underlines mark characters the engine was unsure of.
      </p>

      {sel && (
        <div className="fixer">
          <label>
            Should be{' '}
            <input value={fix} onChange={(e) => setFix(e.target.value)} aria-label="Correct text" />
          </label>
          <label>
            Context{' '}
            <input
              type="number"
              min={0}
              max={6}
              value={context}
              onChange={(e) => setContext(clamp(Number(e.target.value) || 0, 0, 6))}
              aria-label="Characters of context"
            />{' '}
            characters each side
          </label>
          <p className="status">
            Selected <code>{selected}</code>
            {wrongText !== selected && (
              <>
                {' '}
                in <code>{wrongText}</code>
              </>
            )}
          </p>
          <div className="actions">
            <button type="button" disabled={!changed || !fix} onClick={() => add(rightText)}>
              Add word: {rightText}
            </button>
            <button type="button" disabled={!changed} onClick={() => add(`${wrongText} → ${rightText}`)}>
              Always replace: {wrongText} → {rightText}
            </button>
            <button type="button" onClick={() => setPicked(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {note && <p className="status">{note}</p>}
    </div>
  )
}

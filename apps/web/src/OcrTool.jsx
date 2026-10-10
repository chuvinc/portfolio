import { useEffect, useMemo, useRef, useState } from 'react'
import FixableText from './FixableText'
import { applyGlossary, parseGlossary } from './glossary'
import { LANGUAGES, readsRightToLeft } from './languages'
import {
  LAYOUTS,
  MIN_CONFIDENCE,
  classifyRegion,
  findTextRegions,
  readRegions,
  recognize,
  usesRegions,
} from './ocr'
import { entriesFromText } from './postprocess'
import { brightnessOf } from './preprocess'
import { orderRegions } from './regions'

const IDLE = {
  image: null,
  previewUrl: null,
  text: '',
  entries: null, // whole-image reads: characters with confidence, for the glossary
  detected: null,
  regions: null, // text groups on the page, in image pixels (region mode only)
  activeId: null, // the box being inspected, which can have its own contrast
  selected: [], // ids of boxes picked for a bulk action (delete, switch on/off, contrast)
  page: null,
  brightness: 128, // the picture's average brightness, the pivot for the contrast preview
  edit: null, // text the user rewrote by hand: { from: the text it was made from, text }
  status: '',
  progress: 0,
  error: null,
}

const GLOSSARY_KEY = 'ocr-glossary' // kept in this browser only, never sent anywhere

const MIN_DRAG = 0.01 // smallest box you can draw, as a share of the image
const clamp = (n) => Math.min(1, Math.max(0, n))

// e.g. "vertical text, 3 lines → "One block of text" (Japanese)"
function describe({ direction, lines, psm, language }) {
  const layout = LAYOUTS.find((l) => l.id === psm)?.label ?? psm
  const lang = language === 'jpn_vert' ? 'Japanese, vertical model' : (LANGUAGES.find((l) => l.id === language)?.label ?? language)
  return `${direction} text, ${lines} line${lines === 1 ? '' : 's'} → "${layout}" (${lang})`
}

// Text of the regions that are switched on, in reading order. Regions Tesseract was
// unsure of (likely ghost text) are left out unless asked for.
function regionText(regions, page, language, showLow, glossary) {
  const shown = regions.filter(
    (r) => r.included && r.text && (showLow || r.confidence >= MIN_CONFIDENCE),
  )
  const parts = orderRegions(shown, page.height, readsRightToLeft(language.split('+')[0])).map((r) =>
    r.entries ? applyGlossary(r.entries, glossary) : { entries: entriesFromText(r.text), text: r.text, fixed: 0 },
  )
  const blankLine = [{ ch: '\n', conf: 100 }, { ch: '\n', conf: 100 }]
  const entries = parts.flatMap((p, i) => (i ? [...blankLine, ...p.entries] : p.entries))
  return { entries, text: entries.map((e) => e.ch).join(''), fixed: parts.reduce((n, p) => n + p.fixed, 0) }
}

// What a box is doing: 'off' (not read), 'low' (read, but the engine was unsure) or 'on'.
const boxKind = (r, showLow) => {
  if (!r.included) return 'off'
  if (r.text !== undefined && !showLow && r.confidence < MIN_CONFIDENCE) return 'low'
  return 'on'
}

// Boxes over the preview. A short press toggles the smallest box under the pointer;
// dragging draws a new box, even on top of existing ones.
function RegionOverlay({ regions, page, showLow, activeId, selected, onToggle, onSelect, onAdd, onExpand }) {
  const [drag, setDrag] = useState(null)
  const dragged = useRef(false) // a drag ends with a click event we must ignore

  const point = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) }
  }
  const pct = (v, total) => `${(v / total) * 100}%`

  const finishDrag = () => {
    if (!drag) return
    const x = Math.min(drag.x0, drag.x1)
    const y = Math.min(drag.y0, drag.y1)
    const w = Math.abs(drag.x1 - drag.x0)
    const h = Math.abs(drag.y1 - drag.y0)
    setDrag(null)
    if (w < MIN_DRAG || h < MIN_DRAG) return
    dragged.current = true
    onAdd({
      x: Math.round(x * page.width),
      y: Math.round(y * page.height),
      w: Math.max(1, Math.round(w * page.width)),
      h: Math.max(1, Math.round(h * page.height)),
    })
  }

  const toggleAt = (e) => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    const { x, y } = point(e)
    const px = x * page.width
    const py = y * page.height
    const hit = regions
      .filter((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0]
    if (!hit) return
    // Ctrl/Cmd-click picks boxes for a bulk action; a plain click switches the box on or off.
    if (e.ctrlKey || e.metaKey) onSelect(hit.id)
    else onToggle(hit.id)
  }

  // Double-clicking empty space expands the picture. On a box it does nothing extra (two clicks
  // just switch it on and off again), so double-clicking a box never moves the layout.
  const expandAt = (e) => {
    const { x, y } = point(e)
    const px = x * page.width
    const py = y * page.height
    if (!regions.some((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h)) onExpand()
  }

  // Biggest first, so small boxes paint on top of the ones containing them.
  const painted = [...regions].sort((a, b) => b.w * b.h - a.w * a.h)

  return (
    <div
      className="overlay"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        dragged.current = false
        const p = point(e)
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      }}
      onPointerMove={(e) => {
        if (!drag) return
        const p = point(e)
        setDrag({ ...drag, x1: p.x, y1: p.y })
      }}
      onPointerUp={finishDrag}
      onPointerCancel={() => setDrag(null)}
      onClick={toggleAt}
      onDoubleClick={expandAt}
    >
      {painted.map((r) => (
        <div
          key={r.id}
          className={`region ${boxKind(r, showLow)}${r.id === activeId ? ' active' : ''}${selected.includes(r.id) ? ' selected' : ''}`}
          style={{
            left: pct(r.x, page.width),
            top: pct(r.y, page.height),
            width: pct(r.w, page.width),
            height: pct(r.h, page.height),
          }}
        >
          <span className="tag">{r.id}</span>
        </div>
      ))}
      {drag && (
        <div
          className="region drawing"
          style={{
            left: `${Math.min(drag.x0, drag.x1) * 100}%`,
            top: `${Math.min(drag.y0, drag.y1) * 100}%`,
            width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
            height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
          }}
        />
      )}
    </div>
  )
}

// The contrast applied to the preview, as an SVG filter so it matches what gets read:
// out = (in - brightness) * factor + brightness, per colour channel.
function ContrastFilter({ id, factor, brightness }) {
  const intercept = (brightness * (1 - factor)) / 255
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="linear" slope={factor} intercept={intercept} />
          <feFuncG type="linear" slope={factor} intercept={intercept} />
          <feFuncB type="linear" slope={factor} intercept={intercept} />
        </feComponentTransfer>
      </filter>
    </svg>
  )
}

// Every box in a list, to pick several and act on them together.
function BoxList({ regions, selected, activeId, showLow, pageContrast, onPick, onSelectAll, onSelectNone, onActivate, onTurn, onDelete, onContrast }) {
  const [bulk, setBulk] = useState(pageContrast)
  const word = { on: 'on', off: 'off', low: 'unsure' }
  return (
    <div className="boxlist">
      <div className="boxlist-head">
        <strong>Boxes ({regions.length})</strong>
        <button type="button" onClick={onSelectAll}>
          Select all
        </button>
        <button type="button" onClick={onSelectNone} disabled={selected.length === 0}>
          Select none
        </button>
      </div>
      <ul>
        {[...regions]
          .sort((a, b) => a.id - b.id)
          .map((r) => (
            <li key={r.id} className={r.id === activeId ? 'active' : ''} onClick={() => onActivate(r.id)}>
              <label onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={() => onPick(r.id)}
                  aria-label={`Select box ${r.id}`}
                />{' '}
              </label>
              <span>
                #{r.id} · {r.direction} · {word[boxKind(r, showLow)]}
                {r.confidence !== undefined && ` · ${Math.round(r.confidence)}%`}
              </span>
            </li>
          ))}
      </ul>
      {selected.length > 0 && (
        <div className="bulk">
          <strong>{selected.length} selected</strong>
          <div className="actions">
            <button type="button" onClick={() => onTurn(true)}>
              Turn on
            </button>
            <button type="button" onClick={() => onTurn(false)}>
              Turn off
            </button>
            <button type="button" className="danger" onClick={onDelete}>
              Delete selected
            </button>
          </div>
          <label>
            Contrast for selected{' '}
            <input
              type="range"
              min={100}
              max={300}
              step={10}
              value={bulk}
              onChange={(e) => {
                setBulk(Number(e.target.value))
                onContrast(Number(e.target.value))
              }}
              aria-label="Contrast for selected boxes"
            />{' '}
            {bulk}%
          </label>
        </div>
      )}
    </div>
  )
}

// A close-up of one box with its own contrast slider, for text that needs a different setting from
// the rest of the page (faded caption, outlined sound effect). Leaving it alone uses the page's.
function BoxInspector({ region, page, imageUrl, brightness, pageContrast, onContrast, onDelete }) {
  const effective = region.contrast ?? pageContrast
  const scale = Math.min(3, 320 / Math.max(region.w, region.h))
  return (
    <div className="inspector">
      <ContrastFilter id="contrast-box" factor={effective / 100} brightness={brightness} />
      <div
        className="closeup"
        role="img"
        aria-label={`Close-up of box ${region.id}`}
        style={{
          width: region.w * scale,
          height: region.h * scale,
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: `${page.width * scale}px ${page.height * scale}px`,
          backgroundPosition: `${-region.x * scale}px ${-region.y * scale}px`,
          filter: effective > 100 ? 'url(#contrast-box)' : undefined,
        }}
      />
      <div className="inspector-controls">
        <strong>Box #{region.id}</strong>
        <label>
          Contrast for this box{' '}
          <input
            type="range"
            min={100}
            max={300}
            step={10}
            value={effective}
            onChange={(e) => onContrast(Number(e.target.value))}
            aria-label="Contrast for this box"
          />{' '}
          {effective}%
        </label>
        {region.contrast !== undefined && (
          <button type="button" onClick={() => onContrast(undefined)}>
            Use the page setting ({pageContrast}%)
          </button>
        )}
        <span className="hint">Changing it means this box is read again.</span>
        <button type="button" className="danger" onClick={onDelete}>
          Delete this box
        </button>
      </div>
    </div>
  )
}

export default function OcrTool() {
  const [state, setState] = useState(IDLE)
  const [options, setOptions] = useState({
    language: LANGUAGES[0].id,
    layout: LAYOUTS[0].id,
    contrast: 100, // percent; 100 leaves the picture alone
    allowLatin: false,
  })
  const [showLow, setShowLow] = useState(false)
  const [expanded, setExpanded] = useState(false) // false: picture on the left, controls beside it
  const [editing, setEditing] = useState(false) // the text box for rewriting the result by hand is open
  const [draft, setDraft] = useState('')
  const [glossaryText, setGlossaryText] = useState(() => {
    try {
      return localStorage.getItem(GLOSSARY_KEY) ?? ''
    } catch {
      return '' // storage blocked: the glossary just won't persist
    }
  })
  const glossary = useMemo(() => parseGlossary(glossaryText), [glossaryText])
  const updateGlossary = (value) => {
    setGlossaryText(value)
    try {
      if (value) localStorage.setItem(GLOSSARY_KEY, value)
      else localStorage.removeItem(GLOSSARY_KEY)
    } catch {
      // see above
    }
  }
  const [sensitivity, setSensitivity] = useState('normal')
  const previewUrl = useRef(null)
  const run = useRef(0)
  const nextRegionId = useRef(1)

  // Drops the image, preview URL and extracted text from memory.
  const clear = () => {
    run.current += 1 // ignore results from any in-flight run
    setEditing(false)
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
    setState(IDLE)
  }

  useEffect(() => {
    const revoke = () => previewUrl.current && URL.revokeObjectURL(previewUrl.current)
    window.addEventListener('pagehide', revoke)
    return () => {
      window.removeEventListener('pagehide', revoke)
      revoke()
    }
  }, [])

  const load = (file) => {
    if (!file?.type.startsWith('image/')) return
    clear()
    previewUrl.current = URL.createObjectURL(file)
    setState({ ...IDLE, image: file, previewUrl: previewUrl.current })
    const id = run.current
    brightnessOf(file)
      .then((brightness) => run.current === id && setState((s) => ({ ...s, brightness })))
      .catch(() => {}) // the preview just pivots on mid-gray if the picture can't be measured
  }

  // Listen on the whole page so Ctrl+V works without clicking into the drop box
  // (clicking it opens the file picker). The ref keeps the listener on the latest `load`.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  useEffect(() => {
    const onPaste = (e) => {
      const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      loadRef.current(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  // Adds a line to the glossary (from the click-to-fix panel), skipping ones already there.
  const addGlossaryLine = (line) => {
    if (glossaryText.split(/\r?\n/).some((l) => l.trim() === line)) return
    updateGlossary(glossaryText.trimEnd() ? `${glossaryText.trimEnd()}\n${line}` : line)
  }

  const progress = (id) => (m) => {
    if (run.current === id) setState((s) => ({ ...s, status: m.status, progress: m.progress }))
  }

  // Runs an async step, ignoring its result if the user cleared or restarted meanwhile.
  const guarded = async (start, work) => {
    const id = ++run.current
    setState((s) => ({ ...s, ...start, edit: null, error: null, progress: 0 }))
    try {
      const update = await work(id)
      if (run.current === id) setState((s) => ({ ...s, ...update(s) }))
    } catch (error) {
      if (run.current === id) setState((s) => ({ ...s, error, status: '' }))
    }
  }

  const extract = () =>
    guarded({ text: '', entries: null, detected: null, status: 'starting' }, async (id) => {
      const { text, entries, detected } = await recognize(state.image, options, progress(id))
      return () => ({ text, entries: entries ?? null, detected, status: 'done', progress: 1 })
    })

  const findRegions = () =>
    guarded({ regions: null, status: 'finding text regions' }, async () => {
      const { regions, page } = await findTextRegions(state.image, sensitivity, options.contrast)
      nextRegionId.current = regions.length + 1
      const found = regions.map((r, i) => ({ ...r, id: i + 1, included: false }))
      return () => ({ regions: found, page, activeId: null, selected: [], status: '' })
    })

  const readNow = (regions) =>
    guarded({ status: 'starting' }, async (id) => {
      const todo = regions.filter((r) => r.included && r.text === undefined)
      const results = await readRegions(state.image, todo, options, progress(id))
      return (s) => ({
        status: 'done',
        progress: 1,
        regions: s.regions.map((r) => {
          const hit = results.find((x) => x.id === r.id)
          return hit ? { ...r, text: hit.text, entries: hit.entries, confidence: hit.confidence } : r
        }),
      })
    })

  const readPending = () => readNow(state.regions)

  // Switch every box on and read them all; the low-confidence ones are then hidden automatically.
  const readAll = () => {
    const all = state.regions.map((r) => ({ ...r, included: true }))
    setState((s) => ({ ...s, regions: all }))
    readNow(all)
  }

  const toggleRegion = (id) =>
    setState((s) => ({ ...s, activeId: id, regions: s.regions.map((r) => (r.id === id ? { ...r, included: !r.included } : r)) }))

  // Removes a box entirely (its text leaves the result too).
  const deleteRegions = (ids) =>
    setState((s) => ({
      ...s,
      activeId: ids.includes(s.activeId) ? null : s.activeId,
      selected: s.selected.filter((id) => !ids.includes(id)),
      regions: s.regions.filter((r) => !ids.includes(r.id)),
    }))

  const toggleSelect = (id) =>
    setState((s) => ({ ...s, selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id] }))

  const setSelection = (ids) => setState((s) => ({ ...s, selected: ids }))

  const setIncluded = (ids, included) =>
    setState((s) => ({ ...s, regions: s.regions.map((r) => (ids.includes(r.id) ? { ...r, included } : r)) }))

  // Sets one box's own contrast (undefined = follow the page) and clears what was read from it.
  const setRegionsContrast = (ids, value) =>
    setState((s) => ({
      ...s,
      regions: s.regions.map((r) =>
        ids.includes(r.id) ? { ...r, contrast: value, text: undefined, entries: undefined, confidence: undefined, ink: undefined } : r,
      ),
    }))

  const setAllRegions = (included) =>
    setState((s) => ({ ...s, regions: s.regions.map((r) => ({ ...r, included })) }))

  const addRegion = async (box) => {
    const id = run.current
    try {
      const info = await classifyRegion(state.image, box)
      if (run.current !== id) return
      const region = { ...box, ...info, id: nextRegionId.current++, included: true }
      setState((s) => ({ ...s, activeId: region.id, regions: [...s.regions, region] }))
    } catch {
      // A box we can't analyse is simply not added.
    }
  }

  const changeOptions = (patch) => {
    const next = { ...options, ...patch }
    setOptions(next)
    setState((s) => {
      if (!s.regions) return s
      if (!usesRegions(next)) return { ...s, regions: null, status: '' }
      // Read text depends on these settings; boxes stay.
      if ('language' in patch || 'contrast' in patch || 'allowLatin' in patch) {
        return { ...s, regions: s.regions.map((r) => ({ ...r, text: undefined, entries: undefined, confidence: undefined })), status: '' }
      }
      return s
    })
  }

  const regionMode = usesRegions(options)
  const activeRegion = state.regions?.find((r) => r.id === state.activeId)
  const selectedIds = state.selected.filter((id) => state.regions?.some((r) => r.id === id))
  const busy = state.status && state.status !== 'done'
  const pending = state.regions?.filter((r) => r.included && r.text === undefined).length ?? 0
  const regionsRead = state.regions?.some((r) => r.text !== undefined)
  const hasOutput = regionMode ? regionsRead : state.status === 'done'
  const shown =
    regionMode && state.regions
      ? regionText(state.regions, state.page, options.language, showLow, glossary)
      : state.entries
        ? applyGlossary(state.entries, glossary)
        : { entries: entriesFromText(state.text), text: state.text, fixed: 0 }
  // A hand edit stands only while the text it was made from is unchanged: toggling a box, a new read
  // or a glossary change makes it stale, and the app's own text comes back.
  const edited = state.edit && state.edit.from === shown.text ? state.edit : null
  const view = edited ? { entries: entriesFromText(edited.text), text: edited.text, fixed: 0 } : shown
  const output = view.text

  return (
    <div className="ocr">
      <p className="status">
        Your image is read in this browser tab. It is never uploaded or saved, and nothing is
        cached afterwards.
      </p>

      <label
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          load(e.dataTransfer.files[0])
        }}
      >
        Drop an image here, press Ctrl+V to paste one, or click to choose a file
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            load(e.target.files[0])
            e.target.value = ''
          }}
        />
      </label>

      {state.previewUrl && (
        <>
          <div className="viewbar">
            <button type="button" onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Shrink image' : 'Expand image'}
            </button>
            <span className="hint">
              {expanded
                ? 'The controls are below the picture.'
                : 'Double-click empty space on the picture to expand it.'}
            </span>
          </div>
          <div className={`workspace${expanded ? ' expanded' : ''}`}>
            <div className="stage">
              <div className="previewBox">
                <img
                  className="preview"
                  src={state.previewUrl}
                  alt="Selected for text extraction"
                  style={options.contrast > 100 ? { filter: 'url(#contrast-preview)' } : undefined}
                  onDoubleClick={() => setExpanded((e) => !e)}
                />
                <ContrastFilter id="contrast-preview" factor={options.contrast / 100} brightness={state.brightness} />
                {regionMode && state.regions && (
                  <RegionOverlay
                    regions={state.regions}
                    page={state.page}
                    showLow={showLow}
                    activeId={state.activeId}
                    selected={selectedIds}
                    onToggle={toggleRegion}
                    onSelect={toggleSelect}
                    onAdd={addRegion}
                    onExpand={() => setExpanded((e) => !e)}
                  />
                )}
              </div>
            </div>
            <div className="sidebar">
              <div className="actions bar">
                {!regionMode && (
                  <button type="button" onClick={extract} disabled={busy}>
                    Extract text
                  </button>
                )}
                {regionMode && !state.regions && (
                  <button type="button" onClick={findRegions} disabled={busy}>
                    Find text regions
                  </button>
                )}
                {regionMode && state.regions && (
                  <>
                    <button type="button" onClick={readPending} disabled={busy || pending === 0}>
                      Read {pending} region{pending === 1 ? '' : 's'}
                    </button>
                    <button type="button" onClick={readAll} disabled={busy}>
                      Read all (hide unsure)
                    </button>
                    <button type="button" onClick={() => setAllRegions(true)} disabled={busy}>
                      All on
                    </button>
                    <button type="button" onClick={() => setAllRegions(false)} disabled={busy}>
                      All off
                    </button>
                    <button type="button" onClick={findRegions} disabled={busy}>
                      Find again
                    </button>
                  </>
                )}
                <button type="button" onClick={clear}>
                  Clear
                </button>
              </div>
              {busy && (
                <progress value={state.progress} max="1" aria-label={state.status}>
                  {state.status}
                </progress>
              )}
              {state.error && <p className="status">Couldn't read that image: {state.error.message}</p>}
              {regionMode && state.regions && (
                <p className="status">
                  Found {state.regions.length} candidate boxes, all switched off (red). Click the ones
                  that really contain text to turn them green. Drag anywhere to draw your own box, even
                  over an existing one. Ctrl-click (Cmd on a Mac) picks boxes for a bulk action.
                  Then read the green regions.
                </p>
              )}
              {regionMode && activeRegion && (
                <BoxInspector
                  region={activeRegion}
                  page={state.page}
                  imageUrl={state.previewUrl}
                  brightness={state.brightness}
                  pageContrast={options.contrast}
                  onContrast={(value) => setRegionsContrast([activeRegion.id], value)}
                  onDelete={() => deleteRegions([activeRegion.id])}
                />
              )}
              {regionMode && state.regions && (
                <BoxList
                  regions={state.regions}
                  selected={selectedIds}
                  activeId={state.activeId}
                  showLow={showLow}
                  pageContrast={options.contrast}
                  onPick={toggleSelect}
                  onSelectAll={() => setSelection(state.regions.map((r) => r.id))}
                  onSelectNone={() => setSelection([])}
                  onActivate={(id) => setState((s) => ({ ...s, activeId: id }))}
                  onTurn={(included) => setIncluded(selectedIds, included)}
                  onDelete={() => deleteRegions(selectedIds)}
                  onContrast={(value) => setRegionsContrast(selectedIds, value)}
                />
              )}
              <div className="options">
                <label>
                  Language{' '}
                  <select
                    value={options.language}
                    onChange={(e) => changeOptions({ language: e.target.value })}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Text layout{' '}
                  <select
                    value={options.layout}
                    onChange={(e) => changeOptions({ layout: e.target.value })}
                  >
                    {LAYOUTS.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>
                {regionMode && (
                  <label>
                    Detection{' '}
                    <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}>
                      <option value="strict">Strict (fewer boxes)</option>
                      <option value="normal">Normal</option>
                      <option value="loose">Loose (more boxes)</option>
                    </select>
                  </label>
                )}
                <label className="contrast">
                  Contrast{' '}
                  <input
                    type="range"
                    min={100}
                    max={300}
                    step={10}
                    value={options.contrast}
                    onChange={(e) => changeOptions({ contrast: Number(e.target.value) })}
                    aria-label="Contrast"
                  />{' '}
                  {options.contrast}%
                  {options.contrast !== 100 && (
                    <>
                      {' '}
                      <button type="button" onClick={() => changeOptions({ contrast: 100 })}>
                        Reset
                      </button>
                    </>
                  )}
                </label>
                <span className="hint">
                  Raise it for faded or grey pages (about 200–250% works best); normal pages don't need it. Use Find again after changing it.
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={options.allowLatin}
                    onChange={(e) => changeOptions({ allowLatin: e.target.checked })}
                  />{' '}
                  Allow English letters and numbers
                </label>
              </div>
            </div>
            <div className="output">
              {hasOutput && (
                <>
                  {!regionMode && state.detected && (
                    <p className="status">Read as: {describe(state.detected)}</p>
                  )}
                  {regionMode && (
                    <label className="options">
                      <span>
                        <input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} />{' '}
                        Include regions Tesseract was unsure about (orange boxes)
                      </span>
                    </label>
                  )}
                  {editing ? (
                    <>
                      <textarea
                        rows={8}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label="Edit extracted text"
                      />
                      <div className="actions">
                        <button
                          type="button"
                          onClick={() => {
                            setState((s) => ({ ...s, edit: { from: shown.text, text: draft } }))
                            setEditing(false)
                          }}
                        >
                          Save
                        </button>
                        <button type="button" onClick={() => setEditing(false)}>
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <FixableText entries={view.entries} onAdd={addGlossaryLine} />
                      {view.fixed > 0 && (
                        <p className="status">
                          Glossary corrected {view.fixed} character{view.fixed === 1 ? '' : 's'}.
                        </p>
                      )}
                      {edited && (
                        <p className="status">
                          Edited by hand. Reading again, or changing the boxes or glossary, replaces it.
                        </p>
                      )}
                      <div className="actions">
                        <button type="button" onClick={() => navigator.clipboard.writeText(output)}>
                          Copy text
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(output)
                            setEditing(true)
                          }}
                        >
                          Edit text
                        </button>
                        {edited && (
                          <button type="button" onClick={() => setState((s) => ({ ...s, edit: null }))}>
                            Reset to original
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <details className="glossary">
            <summary>Glossary and corrections{glossaryText ? ' (in use)' : ''}</summary>
            <p className="status">
              One entry per line. A word or name you expect fixes near-misses: if the text is one
              character off it, and the engine was unsure of that character, your spelling wins.
              A line like <code>ロ → 口</code> always replaces the left side with the right.
              Lines starting with # are notes. Saved in this browser only.
            </p>
            <textarea
              rows={6}
              value={glossaryText}
              onChange={(e) => updateGlossary(e.target.value)}
              placeholder={'ワンピース\nロ → 口\n# character names go here'}
              aria-label="Glossary"
            />
            {glossaryText && (
              <div className="actions">
                <button type="button" onClick={() => updateGlossary('')}>
                  Clear glossary
                </button>
              </div>
            )}
          </details>
        </>
      )}

    </div>
  )
}

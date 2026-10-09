import { useEffect, useRef, useState } from 'react'
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
import { orderRegions } from './regions'

const IDLE = {
  image: null,
  previewUrl: null,
  text: '',
  detected: null,
  regions: null, // text groups on the page, in image pixels (region mode only)
  page: null,
  status: '',
  progress: 0,
  error: null,
}

const MIN_DRAG = 0.01 // smallest box you can draw, as a share of the image
const clamp = (n) => Math.min(1, Math.max(0, n))

// e.g. "vertical text, 3 lines → "One block of text" (Japanese)"
function describe({ direction, lines, psm, language }) {
  const layout = LAYOUTS.find((l) => l.id === psm)?.label ?? psm
  const lang = LANGUAGES.find((l) => l.id === language)?.label ?? language
  return `${direction} text, ${lines} line${lines === 1 ? '' : 's'} → "${layout}" (${lang})`
}

// Text of the regions that are switched on, in reading order. Regions Tesseract was
// unsure of (likely ghost text) are left out unless asked for.
function regionText(regions, page, language, showLow) {
  const shown = regions.filter(
    (r) => r.included && r.text && (showLow || r.confidence >= MIN_CONFIDENCE),
  )
  return orderRegions(shown, page.height, readsRightToLeft(language.split('+')[0]))
    .map((r) => r.text)
    .join('\n\n')
}

// Boxes over the preview. Click a box to switch it on/off; drag on empty space to add one.
function RegionOverlay({ regions, page, showLow, onToggle, onAdd }) {
  const [drag, setDrag] = useState(null)

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
    onAdd({
      x: Math.round(x * page.width),
      y: Math.round(y * page.height),
      w: Math.max(1, Math.round(w * page.width)),
      h: Math.max(1, Math.round(h * page.height)),
    })
  }

  const kind = (r) => {
    if (!r.included) return 'off'
    if (r.text !== undefined && !showLow && r.confidence < MIN_CONFIDENCE) return 'low'
    return 'on'
  }

  return (
    <div
      className="overlay"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        const p = point(e)
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      }}
      onPointerMove={(e) => drag && setDrag({ ...drag, ...(({ x, y }) => ({ x1: x, y1: y }))(point(e)) })}
      onPointerUp={finishDrag}
      onPointerCancel={() => setDrag(null)}
    >
      {regions.map((r) => (
        <div
          key={r.id}
          className={`region ${kind(r)}`}
          title={`${r.direction}${r.confidence == null ? '' : `, ${Math.round(r.confidence)}% confident`}. Click to ${r.included ? 'exclude' : 'include'}.`}
          style={{
            left: pct(r.x, page.width),
            top: pct(r.y, page.height),
            width: pct(r.w, page.width),
            height: pct(r.h, page.height),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onToggle(r.id)}
        />
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

export default function OcrTool() {
  const [state, setState] = useState(IDLE)
  const [options, setOptions] = useState({
    language: LANGUAGES[0].id,
    layout: LAYOUTS[0].id,
    enhance: false,
  })
  const [showLow, setShowLow] = useState(false)
  const previewUrl = useRef(null)
  const run = useRef(0)
  const nextRegionId = useRef(1)

  // Drops the image, preview URL and extracted text from memory.
  const clear = () => {
    run.current += 1 // ignore results from any in-flight run
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

  const progress = (id) => (m) => {
    if (run.current === id) setState((s) => ({ ...s, status: m.status, progress: m.progress }))
  }

  // Runs an async step, ignoring its result if the user cleared or restarted meanwhile.
  const guarded = async (start, work) => {
    const id = ++run.current
    setState((s) => ({ ...s, ...start, error: null, progress: 0 }))
    try {
      const update = await work(id)
      if (run.current === id) setState((s) => ({ ...s, ...update(s) }))
    } catch (error) {
      if (run.current === id) setState((s) => ({ ...s, error, status: '' }))
    }
  }

  const extract = () =>
    guarded({ text: '', detected: null, status: 'starting' }, async (id) => {
      const { text, detected } = await recognize(state.image, options, progress(id))
      return () => ({ text, detected, status: 'done', progress: 1 })
    })

  const findRegions = () =>
    guarded({ regions: null, status: 'finding text regions' }, async () => {
      const { regions, page } = await findTextRegions(state.image)
      nextRegionId.current = regions.length + 1
      const found = regions.map((r, i) => ({ ...r, id: i + 1, included: true }))
      return () => ({ regions: found, page, status: '' })
    })

  const readPending = () =>
    guarded({ status: 'starting' }, async (id) => {
      const todo = state.regions.filter((r) => r.included && r.text === undefined)
      const results = await readRegions(state.image, todo, options, progress(id))
      return (s) => ({
        status: 'done',
        progress: 1,
        regions: s.regions.map((r) => {
          const hit = results.find((x) => x.id === r.id)
          return hit ? { ...r, text: hit.text, confidence: hit.confidence } : r
        }),
      })
    })

  const toggleRegion = (id) =>
    setState((s) => ({ ...s, regions: s.regions.map((r) => (r.id === id ? { ...r, included: !r.included } : r)) }))

  const addRegion = async (box) => {
    const id = run.current
    try {
      const info = await classifyRegion(state.image, box)
      if (run.current !== id) return
      const region = { ...box, ...info, id: nextRegionId.current++, included: true }
      setState((s) => ({ ...s, regions: [...s.regions, region] }))
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
      // Read text depends on the language and enhancement; boxes stay.
      if ('language' in patch || 'enhance' in patch) {
        return { ...s, regions: s.regions.map((r) => ({ ...r, text: undefined, confidence: undefined })), status: '' }
      }
      return s
    })
  }

  const regionMode = usesRegions(options)
  const busy = state.status && state.status !== 'done'
  const pending = state.regions?.filter((r) => r.included && r.text === undefined).length ?? 0
  const regionsRead = state.regions?.some((r) => r.text !== undefined)
  const hasOutput = regionMode ? regionsRead : state.status === 'done'
  const output = regionMode && state.regions ? regionText(state.regions, state.page, options.language, showLow) : state.text

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
          <div className="previewBox">
            <img className="preview" src={state.previewUrl} alt="Selected for text extraction" />
            {regionMode && state.regions && (
              <RegionOverlay
                regions={state.regions}
                page={state.page}
                showLow={showLow}
                onToggle={toggleRegion}
                onAdd={addRegion}
              />
            )}
          </div>
          {regionMode && state.regions && (
            <p className="status">
              Found {state.regions.length} text regions. Click a box to switch it off (red) or back
              on (green), or drag on the image to add your own. Then read the regions.
            </p>
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
            <label>
              <input
                type="checkbox"
                checked={options.enhance}
                onChange={(e) => changeOptions({ enhance: e.target.checked })}
              />{' '}
              Enhance image (upscale, sharpen contrast)
            </label>
          </div>
          <div className="actions">
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
                <button type="button" onClick={findRegions} disabled={busy}>
                  Find again
                </button>
              </>
            )}
            <button type="button" onClick={clear}>
              Clear
            </button>
          </div>
        </>
      )}

      {busy && (
        <progress value={state.progress} max="1" aria-label={state.status}>
          {state.status}
        </progress>
      )}
      {state.error && <p className="status">Couldn't read that image: {state.error.message}</p>}

      {hasOutput && (
        <>
          {!regionMode && state.detected && (
            <p className="status">Auto-detected: {describe(state.detected)}</p>
          )}
          {regionMode && (
            <label className="options">
              <span>
                <input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} />{' '}
                Include regions Tesseract was unsure about (orange boxes)
              </span>
            </label>
          )}
          <textarea readOnly rows={8} value={output} aria-label="Extracted text" />
          <div className="actions">
            <button type="button" onClick={() => navigator.clipboard.writeText(output)}>
              Copy text
            </button>
          </div>
        </>
      )}
    </div>
  )
}

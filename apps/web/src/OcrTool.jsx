import { useEffect, useRef, useState } from 'react'
import { LANGUAGES } from './languages'
import { LAYOUTS, recognize } from './ocr'

const IDLE = { image: null, previewUrl: null, text: '', status: '', progress: 0, error: null }

export default function OcrTool() {
  const [state, setState] = useState(IDLE)
  const [options, setOptions] = useState({
    language: LANGUAGES[0].id,
    layout: LAYOUTS[0].id,
    enhance: false,
  })
  const previewUrl = useRef(null)
  const run = useRef(0)

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

  const onPaste = (e) => {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
    if (file) load(file)
  }

  const extract = async () => {
    const id = ++run.current
    setState((s) => ({ ...s, text: '', error: null, status: 'starting', progress: 0 }))
    try {
      const text = await recognize(state.image, options, (m) => {
        if (run.current === id) setState((s) => ({ ...s, status: m.status, progress: m.progress }))
      })
      if (run.current === id) setState((s) => ({ ...s, text, status: 'done', progress: 1 }))
    } catch (error) {
      if (run.current === id) setState((s) => ({ ...s, error, status: '' }))
    }
  }

  const busy = state.status && state.status !== 'done'

  return (
    <div className="ocr" onPaste={onPaste}>
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
        Drop an image here, paste one, or choose a file
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
          <img className="preview" src={state.previewUrl} alt="Selected for text extraction" />
          <div className="options">
            <label>
              Language{' '}
              <select
                value={options.language}
                onChange={(e) => setOptions({ ...options, language: e.target.value })}
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
                onChange={(e) => setOptions({ ...options, layout: e.target.value })}
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
                onChange={(e) => setOptions({ ...options, enhance: e.target.checked })}
              />{' '}
              Enhance image (upscale, sharpen contrast)
            </label>
          </div>
          <div className="actions">
            <button type="button" onClick={extract} disabled={busy}>
              Extract text
            </button>
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

      {state.status === 'done' && (
        <>
          <textarea readOnly rows={8} value={state.text} aria-label="Extracted text" />
          <div className="actions">
            <button type="button" onClick={() => navigator.clipboard.writeText(state.text)}>
              Copy text
            </button>
          </div>
        </>
      )}
    </div>
  )
}

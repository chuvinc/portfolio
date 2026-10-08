import { useEffect, useState } from 'react'

// Fetches JSON from the API. `data` and `error` are both null while loading.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}${path}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      })
      .then((data) => setState({ data, error: null }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ data: null, error })
      })
    return () => controller.abort()
  }, [path])

  return state
}

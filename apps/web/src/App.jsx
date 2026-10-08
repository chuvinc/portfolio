import { useApi } from './useApi'
import './App.css'

const SKILLS = [
  'GitHub Actions CI/CD',
  'Node.js',
  'React',
  'Docker',
  'Kubernetes',
  'Terraform',
]

function Projects() {
  const { data, error } = useApi('/api/projects')

  if (error) return <p className="status">Couldn't load projects: {error.message}</p>
  if (!data) return <p className="status">Loading projects…</p>

  return (
    <ul className="cards">
      {data.map((p) => (
        <li key={p.id} className="card">
          <h3>
            <a href={p.url} target="_blank" rel="noopener noreferrer">
              {p.name}
            </a>
          </h3>
          <p>{p.summary}</p>
          <ul className="tags">
            {p.tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function BuildInfo() {
  const { data, error } = useApi('/api/build-info')

  if (error) return <span>build info unavailable</span>
  if (!data) return <span>…</span>

  return (
    <span>
      v{data.version} · <code>{data.commit.slice(0, 7)}</code>
      {data.builtAt && ` · built ${data.builtAt}`}
    </span>
  )
}

function App() {
  return (
    <>
      <header>
        <h1>Portfolio</h1>
        <p>Building and shipping software end to end: code, pipelines, containers and infrastructure.</p>
      </header>

      <main>
        <section id="skills">
          <h2>Skills</h2>
          <ul className="tags">
            {SKILLS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>

        <section id="projects">
          <h2>Projects</h2>
          <Projects />
        </section>
      </main>

      <footer>
        This site is served by the pipeline it describes. Running: <BuildInfo />
      </footer>
    </>
  )
}

export default App

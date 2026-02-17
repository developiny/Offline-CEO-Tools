import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="stack">
      <h1>Page not found</h1>
      <p className="muted">That route does not exist.</p>
      <div>
        <Link className="button" to="/">
          Go home
        </Link>
      </div>
    </div>
  )
}


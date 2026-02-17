import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

export default function RouteError() {
  const err = useRouteError()
  let title = 'Unexpected Application Error'
  let detail = 'Something went wrong while rendering this page.'
  if (isRouteErrorResponse(err)) {
    title = `${err.status} ${err.statusText || 'Route Error'}`
    detail = err.data?.message || detail
  } else if (err instanceof Error) {
    detail = err.message || detail
  }

  return (
    <div className="stack">
      <section className="panel">
        <h1>{title}</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {detail}
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          Try refreshing the page. If this keeps happening, share the error text so it can be fixed.
        </p>
      </section>
    </div>
  )
}


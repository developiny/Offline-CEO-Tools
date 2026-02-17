export default function Preview({ title = 'Preview', children }) {
  return (
    <section className="panel">
      <div className="panel__head">
        <div className="panel__title">{title}</div>
      </div>
      <div className="panel__body">{children}</div>
    </section>
  )
}


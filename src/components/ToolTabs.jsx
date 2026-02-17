export default function ToolTabs({ tools, activeId, onChange }) {
  return (
    <div className="tabs" role="tablist" aria-label="Tools">
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          className={'tab' + (t.id === activeId ? ' tab--active' : '')}
          onClick={() => onChange(t.id)}
          role="tab"
          aria-selected={t.id === activeId}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}


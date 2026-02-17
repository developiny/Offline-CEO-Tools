import { RouterProvider } from 'react-router-dom'
import { router } from './router.jsx'

export default function App() {
  return (
    <RouterProvider
      router={router}
      fallbackElement={
        <div className="container" style={{ padding: '24px 0' }}>
          <div className="panel">Loading...</div>
        </div>
      }
    />
  )
}

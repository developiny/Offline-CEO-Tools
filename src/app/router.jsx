import { createHashRouter } from 'react-router-dom'
import Layout from './Layout.jsx'

import Home from '../modules/home/Home.jsx'
import NotFound from '../modules/notfound/NotFound.jsx'
import RouteError from '../modules/notfound/RouteError.jsx'

export const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      {
        path: 'image',
        lazy: async () => ({ Component: (await import('../modules/image/ImageTools.jsx')).default }),
      },
      {
        path: 'pdf',
        lazy: async () => ({ Component: (await import('../modules/pdf/PdfTools.jsx')).default }),
      },
      {
        path: 'text',
        lazy: async () => ({ Component: (await import('../modules/text/TextTools.jsx')).default }),
      },
      {
        path: 'css',
        lazy: async () => ({ Component: (await import('../modules/css/CssTools.jsx')).default }),
      },
      {
        path: 'color',
        lazy: async () => ({ Component: (await import('../modules/color/ColorTools.jsx')).default }),
      },
      {
        path: 'developer',
        lazy: async () => ({ Component: (await import('../modules/developer/DeveloperTools.jsx')).default }),
      },
      {
        path: 'coding',
        lazy: async () => ({ Component: (await import('../modules/coding/CodingTools.jsx')).default }),
      },
      {
        path: 'wasm',
        lazy: async () => ({ Component: (await import('../modules/wasm/WasmTools.jsx')).default }),
      },
      {
        path: 'wasm/*',
        lazy: async () => ({ Component: (await import('../modules/wasm/WasmTools.jsx')).default }),
      },
      {
        path: 'productivity',
        lazy: async () => ({ Component: (await import('../modules/productivity/ProductivityTools.jsx')).default }),
      },
      {
        path: 'social',
        lazy: async () => ({ Component: (await import('../modules/social/SocialTools.jsx')).default }),
      },
      {
        path: 'misc',
        lazy: async () => ({ Component: (await import('../modules/misc/MiscTools.jsx')).default }),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])

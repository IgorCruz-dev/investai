import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import AuthProvider from './contexts/AuthProvider'
import { supabaseConfigurado } from './lib/supabase'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {supabaseConfigurado ? (
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    ) : (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
        <h1 className="text-xl font-semibold">Supabase não configurado</h1>
        <p className="text-texto-suave">
          Crie o arquivo <code className="text-texto">.env.local</code> na raiz do projeto com{' '}
          <code className="text-texto">VITE_SUPABASE_URL</code> e{' '}
          <code className="text-texto">VITE_SUPABASE_ANON_KEY</code> (veja o{' '}
          <code className="text-texto">.env.example</code>) e reinicie o <code className="text-texto">npm run dev</code>.
        </p>
      </div>
    )}
  </StrictMode>,
)

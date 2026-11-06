import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { app } from './engine/app'
import { App } from './ui/App'
import './styles/app.css'

// a handle for the headless check (tools/check.mjs) and for poking at the engine from the console
;(window as unknown as { __vs: typeof app }).__vs = app

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { app } from './engine/app'
import { App } from './ui/App'
import './styles/vidaw.css'
import { theme, wall } from './ui/ui'

document.documentElement.dataset.theme = theme()
document.documentElement.dataset.wall = wall()
// the desktop app (Electron, later): the toolbar leaves room for the traffic lights and drags the window
if (/Electron\//.test(navigator.userAgent)) document.documentElement.classList.add('electron')

// a handle for the headless check (tools/check.mjs) and for poking at the engine from the console
;(window as unknown as { __vs: typeof app }).__vs = app

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

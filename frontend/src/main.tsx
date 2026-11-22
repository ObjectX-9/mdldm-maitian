import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import './studio.css'
import './components/ui/components.css'
import './neko-theme.css'
import './dark-theme.css'
import './mobile.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

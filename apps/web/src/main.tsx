import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import App from './App.js';
import './index.css';
import { SessionProvider } from './session.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// One motion config at the root: dice, cards, and toasts all honor the
// visitor's reduced-motion preference.
createRoot(root).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
);

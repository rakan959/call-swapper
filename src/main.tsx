import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { assertRuntimeEnv } from './config/runtimeEnv';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root not found');
}

assertRuntimeEnv();

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

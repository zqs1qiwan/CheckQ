import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initTheme } from './theme.js';
import '@xyflow/react/dist/style.css';
import './styles.css';

initTheme();
createRoot(document.getElementById('root')).render(<App />);

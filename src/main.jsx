import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

import App from './App.jsx';
import { initTelemetry } from './lib/telemetry.js';

initTelemetry();

createRoot(document.getElementById('root')).render(<App />);

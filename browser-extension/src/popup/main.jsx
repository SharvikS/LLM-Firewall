import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Popup from './Popup.jsx';
import '../styles/app.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);

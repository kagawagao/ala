import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'antd/dist/reset.css';
import './i18n/config'; // Initialize i18n

// JetBrains Mono font and custom CSS
const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
  
  * {
    font-family: 'JetBrains Mono', monospace !important;
  }
  
  /* Fix Ant Design Tabs scrolling issue */
  .log-viewer-tabs .ant-tabs-content-holder {
    overflow: auto;
  }
  
  .log-viewer-tabs .ant-tabs-content {
    height: 100%;
  }
  
  .log-viewer-tabs .ant-tabs-tabpane {
    height: 100%;
    overflow: auto;
  }

  /* macOS-style scrollbar for all platforms */
  * {
    scrollbar-width: thin;
    scrollbar-color: rgba(155, 155, 155, 0.7) transparent;
  }

  /* WebKit scrollbar styling (Chrome, Safari, Edge) */
  *::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  *::-webkit-scrollbar-track {
    background: transparent;
  }

  *::-webkit-scrollbar-thumb {
    background-color: rgba(155, 155, 155, 0.7);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: content-box;
  }

  *::-webkit-scrollbar-thumb:hover {
    background-color: rgba(155, 155, 155, 0.9);
  }

  *::-webkit-scrollbar-thumb:active {
    background-color: rgba(155, 155, 155, 1);
  }

  /* Make scrollbar appear only on hover for even more macOS-like behavior */
  *::-webkit-scrollbar-thumb {
    transition: background-color 0.2s ease;
  }
`;

// Inject global styles
const styleElement = document.createElement('style');
styleElement.textContent = globalStyles;
document.head.appendChild(styleElement);

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

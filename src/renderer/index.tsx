import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'antd/dist/reset.css';
import './i18n/config'; // Initialize i18n

// Custom CSS
const globalStyles = `
  * {
    font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace !important;
  }
  
  /* Make Ant Design Tabs fill available height so VirtualList gets the full area */
  .log-viewer-tabs {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .log-viewer-tabs .ant-tabs-content-holder {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .log-viewer-tabs .ant-tabs-content {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .log-viewer-tabs .ant-tabs-tabpane {
    height: 100%;
    overflow: hidden;
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

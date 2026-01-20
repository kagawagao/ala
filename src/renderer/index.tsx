import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'antd/dist/reset.css';

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

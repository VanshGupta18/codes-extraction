import React from 'react';
import { renderToString } from 'react-dom/server';
import App from './src/pages/IngestionPage.jsx';

try {
  console.log("Rendering...");
  renderToString(React.createElement(App));
  console.log("Success");
} catch(e) {
  console.error("ERROR:", e);
}

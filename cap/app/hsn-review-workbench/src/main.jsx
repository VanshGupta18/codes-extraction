import { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider } from '@ui5/webcomponents-react';
import './index.css';
import App from './App.jsx';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', background: '#1e1e1e', color: '#f87171', minHeight: '100vh' }}>
          <h2 style={{ color: '#fca5a5' }}>🔴 Runtime Error — Application Crashed</h2>
          <pre style={{ background: '#2d2d2d', padding: '1rem', borderRadius: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error.toString()}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);

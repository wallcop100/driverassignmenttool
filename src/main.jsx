import 'bootstrap/dist/css/bootstrap.min.css';
import 'material-icons/iconfont/material-icons.css';
import 'companion-kit/reporter.css';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { dropSent } from './bugReports.js';
import './styles.css';

dropSent();   // before the reporter reads them
createRoot(document.getElementById('root')).render(<App />);

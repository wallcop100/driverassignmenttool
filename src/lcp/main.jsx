// The LCP tool's entry. Same App, same core, a different subject — the domain
// pack and the message/storage prefixes are the whole difference.
import 'bootstrap/dist/css/bootstrap.min.css';
import 'material-icons/iconfont/material-icons.css';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';
import lcp from './domain.js';
import { setPrefix } from '../embed.js';
import { setStoragePrefix } from '../persist.js';
import '../styles.css';

// Before anything renders: this build answers to lcp:* and saves under its own
// key, so a driver session in the same host page or the same browser cannot be
// confused with it.
setPrefix(lcp.msgPrefix);
setStoragePrefix(lcp.storagePrefix);

createRoot(document.getElementById('root')).render(<App domain={lcp} />);

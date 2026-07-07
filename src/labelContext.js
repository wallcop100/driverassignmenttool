import { createContext } from 'react';
import { DEFAULT_PREFS } from './state.js';

// Cable-label field config, read by Block deep in the tree. Its own module so
// Block doesn't have to import App (which would be a circular dependency).
export const LabelContext = createContext(DEFAULT_PREFS.label);

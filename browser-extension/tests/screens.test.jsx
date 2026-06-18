// Smoke test for the popup and options React apps. Server-renders each (effects
// don't run under SSR, so the WebExtension APIs are never touched) to confirm
// the component trees — design-system primitives, Framer Motion, Lucide icons —
// build without throwing and surface their initial UI.
import { renderToStaticMarkup } from 'react-dom/server';
import Popup from '../src/popup/Popup.jsx';
import Options from '../src/options/Options.jsx';

describe('popup', () => {
  test('renders the brand, protection toggle, and stat tiles', () => {
    const html = renderToStaticMarkup(<Popup />);
    expect(html).toContain('TITAN');
    expect(html).toContain('Protection');
    expect(html).toContain('Blocked');
    expect(html).toContain('Redacted');
    expect(html).toContain('Override');
  });
});

describe('options', () => {
  test('renders without throwing (initial loading state)', () => {
    const html = renderToStaticMarkup(<Options />);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });
});
